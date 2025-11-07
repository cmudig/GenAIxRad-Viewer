import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';
import { rankDisplaySetsByPrompt, RankedDisplaySet } from './similarity';
import { setDisplaySetOrigin } from './utils/displaySetOrigin';

type ExampleComponentProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type ComparisonMode = 'similar' | 'dissimilar';

const MIN_COMPARISONS = 2;
const MAX_COMPARISONS = 5;
const PMAP_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.30';

const GRID_LAYOUTS: Record<number, { numCols: number; numRows: number }> = {
  1: { numCols: 1, numRows: 1 },
  2: { numCols: 2, numRows: 1 },
  3: { numCols: 3, numRows: 1 },
  4: { numCols: 2, numRows: 2 },
  5: { numCols: 3, numRows: 2 },
  6: { numCols: 3, numRows: 2 },
};

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  if (Array.isArray(state.viewports)) {
    return state.viewports;
  }

  if (typeof state.viewports.values === 'function') {
    return Array.from(state.viewports.values());
  }

  if (typeof state.viewports === 'object') {
    return Object.values(state.viewports);
  }

  return [];
};

const normalizeWord = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const tokenizeDescription = (description: string): string[] => {
  if (!description) {
    return [];
  }
  const tokens = new Set<string>();
  const normalized = normalizeWord(description);
  if (normalized) {
    tokens.add(normalized);
  }
  description
    .split(/[\s,_-]+/)
    .map(part => normalizeWord(part))
    .forEach(token => {
      if (token) {
        tokens.add(token);
      }
    });
  return Array.from(tokens);
};

const getSeriesDescription = (displaySet: any): string => {
  if (!displaySet) {
    return '';
  }
  return (
    displaySet.SeriesDescription ??
    displaySet.seriesDescription ??
    displaySet.metadata?.SeriesDescription ??
    displaySet.getAttribute?.('SeriesDescription') ??
    ''
  );
};

const getReferencedSeriesInstanceUID = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }

  return (
    displaySet.referencedSeriesInstanceUID ??
    displaySet.ReferencedSeriesInstanceUID ??
    displaySet.metadata?.ReferencedSeriesInstanceUID ??
    displaySet.getAttribute?.('ReferencedSeriesInstanceUID') ??
    null
  );
};

const ExampleComponent: React.FC<ExampleComponentProps> = ({ servicesManager }) => {
  const initialViewportRef = useRef<
    | null
    | {
        displaySetInstanceUIDs: string[];
        displaySetOptions?: any;
        viewportOptions?: any;
      }
  >(null);
  const initialPromptRef = useRef<string | null>(null);

  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;
  const hangingProtocolService =
    servicesManager?.services?.hangingProtocolService ||
    servicesManager?.services?.HangingProtocolService;
  const uiNotificationService =
    servicesManager?.services?.uiNotificationService ||
    servicesManager?.services?.UINotificationService;

  const [activeViewportId, setActiveViewportId] = useState<string | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [activeDisplaySetUID, setActiveDisplaySetUID] = useState<string | null>(null);
  const [seriesInstanceUID, setSeriesInstanceUID] = useState<string | null>(null);
  const [seriesPrompt, setSeriesPrompt] = useState<string | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  const [numComparisons, setNumComparisons] = useState<number>(MIN_COMPARISONS);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('similar');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAppliedMatches, setLastAppliedMatches] = useState<RankedDisplaySet[]>([]);
  const [matchPrompts, setMatchPrompts] = useState<Record<string, string | null>>({});
  const [loadingMatchPrompts, setLoadingMatchPrompts] = useState(false);
  const promptRequestRef = useRef(0);
  const [clsOverlaysVisible, setClsOverlaysVisible] = useState(false);
  const [clsToggleBusy, setClsToggleBusy] = useState(false);
  const [clsTargetsAvailable, setClsTargetsAvailable] = useState(false);
  const clsAssignmentsRef = useRef<
    Map<
      string,
      {
        baseDisplaySetUID: string;
        baseSeriesInstanceUID: string | null;
        description: string;
      }
    >
  >(new Map());
  const clsPmapCacheRef = useRef<Map<string, string>>(new Map());

  const activeDisplaySet = useMemo(() => {
    if (!activeDisplaySetUID || !displaySetService?.getDisplaySetByUID) {
      return null;
    }

    try {
      return displaySetService.getDisplaySetByUID(activeDisplaySetUID);
    } catch (err) {
      console.warn('ExampleComponent: Failed to resolve display set by UID', err);
      return null;
    }
  }, [activeDisplaySetUID, displaySetService]);

  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    const readState = () =>
      viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();

    const initialState = readState();
    const initialViewports = getViewportsArray(initialState);
    const initialActive = initialState?.activeViewportId ?? initialViewports[0]?.viewportId ?? null;

    if (initialActive) {
      setActiveViewportId(initialActive);
    }

    const handleGridChange = () => {
      const nextState = readState();
      const viewports = getViewportsArray(nextState);
      const fallback = nextState?.activeViewportId ?? viewports[0]?.viewportId ?? null;

      setViewportVersion(prev => prev + 1);
      if (fallback) {
        setActiveViewportId(fallback);
      }
    };

    const handleActiveViewportChange = ({ viewportId }: { viewportId: string }) => {
      setViewportVersion(prev => prev + 1);
      setActiveViewportId(viewportId);
    };

    const activeSub = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
      handleActiveViewportChange
    );

    const gridSub = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
      handleGridChange
    );

    return () => {
      activeSub?.unsubscribe?.();
      gridSub?.unsubscribe?.();
    };
  }, [viewportGridService]);

  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    const viewports = getViewportsArray(state);

    const activeViewport = viewports.find(v => v?.viewportId === activeViewportId) ?? viewports[0];

    const displaySetUid =
      activeViewport?.displaySetInstanceUIDs?.[0] ||
      activeViewport?.displaySetOptions?.displaySetInstanceUIDs?.[0] ||
      null;

    setActiveDisplaySetUID(displaySetUid ?? null);
  }, [viewportGridService, activeViewportId, viewportVersion]);

  useEffect(() => {
    setSeriesInstanceUID((activeDisplaySet as any)?.SeriesInstanceUID ?? null);
  }, [activeDisplaySet]);

  useEffect(() => {
    let cancelled = false;

    async function loadSeriesPrompt() {
      if (!seriesInstanceUID) {
        setSeriesPrompt(null);
        setLoadingPrompt(false);
        return;
      }

      if (!initialPromptRef.current) {
        initialPromptRef.current = seriesInstanceUID;
      }

      setLoadingPrompt(true);
      try {
        const prompt = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPrompt');
        if (!cancelled) {
          const promptText = typeof prompt === 'string' ? prompt.trim() : '';
          setSeriesPrompt(promptText || null);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('ExampleComponent: Failed to fetch SeriesPrompt metadata', err);
          setSeriesPrompt(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingPrompt(false);
        }
      }
    }

    loadSeriesPrompt();

    return () => {
      cancelled = true;
    };
  }, [seriesInstanceUID]);

  useEffect(() => {
    setError(null);
    setLastAppliedMatches([]);
    setClsOverlaysVisible(false);
  }, [seriesInstanceUID]);

  const handleComparisonModeChange = useCallback((mode: ComparisonMode) => {
    setComparisonMode(mode);
  }, []);

  const handleNumComparisonsChange = useCallback((value: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const clamped = Math.max(MIN_COMPARISONS, Math.min(MAX_COMPARISONS, Math.round(parsed)));
    setNumComparisons(clamped);
  }, []);

  const loadPromptsForMatches = useCallback(async (matches: RankedDisplaySet[]) => {
    const requestId = ++promptRequestRef.current;

    if (!matches.length) {
      setMatchPrompts({});
      setLoadingMatchPrompts(false);
      return;
    }

    setLoadingMatchPrompts(true);

    const entries = await Promise.all(
      matches.map(async match => {
        const ds = match.displaySet as any;
        const displaySetInstanceUID = ds?.displaySetInstanceUID;
        const seriesUID = ds?.SeriesInstanceUID || ds?.seriesInstanceUID || null;

        if (!displaySetInstanceUID || !seriesUID) {
          return { displaySetInstanceUID, prompt: null };
        }

        try {
          const value = await getMetadataFromSeries(seriesUID, 'SeriesPrompt');
          const prompt = typeof value === 'string' && value.trim() ? value.trim() : null;
          return { displaySetInstanceUID, prompt };
        } catch (error) {
          console.warn('ExampleComponent: failed to load prompt for series', seriesUID, error);
          return { displaySetInstanceUID, prompt: null };
        }
      })
    );

    if (promptRequestRef.current !== requestId) {
      return;
    }

    const promptMap: Record<string, string | null> = {};
    entries.forEach(entry => {
      if (!entry.displaySetInstanceUID) {
        return;
      }
      promptMap[entry.displaySetInstanceUID] = entry.prompt;
    });

    setMatchPrompts(promptMap);
    setLoadingMatchPrompts(false);
  }, []);

  const applyExamples = useCallback(async () => {
    if (!viewportGridService || !displaySetService) {
      setError('Viewport services are unavailable.');
      return;
    }

    if (!activeDisplaySet) {
      setError('Select a series in the viewport to compare.');
      return;
    }

    if (!seriesPrompt) {
      setError('Series prompt metadata is missing for the active series.');
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const allDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];

      if (!allDisplaySets.length) {
        setError('No other series available for comparison.');
        return;
      }

      const ranked = rankDisplaySetsByPrompt(allDisplaySets, seriesPrompt, {
        promptContext: {
          modality: (activeDisplaySet as any)?.Modality,
          bodyPart: (activeDisplaySet as any)?.BodyPartExamined,
        },
      });

      const activeModality = String((activeDisplaySet as any)?.Modality || '').toUpperCase();
      const filtered = ranked.filter(item => {
        const candidateUID = item.displaySet.displaySetInstanceUID;
        const candidateModality = String(item.displaySet.Modality || '').toUpperCase();
        const isSameDisplaySet = candidateUID === (activeDisplaySet as any)?.displaySetInstanceUID;

        if (isSameDisplaySet) {
          return false;
        }

        if (candidateModality === 'PMAP') {
          return false;
        }

        if (activeModality) {
          return candidateModality === activeModality;
        }

        return candidateModality === 'AI';
      });

      const comparisonsRequested = Math.max(
        MIN_COMPARISONS,
        Math.min(MAX_COMPARISONS, numComparisons)
      );

      if (filtered.length < comparisonsRequested) {
        setError(
          `Only ${filtered.length} comparable series available, but ${comparisonsRequested} requested.`
        );
        return;
      }

      let selected: RankedDisplaySet[];
      if (comparisonMode === 'similar') {
        selected = filtered.slice(0, comparisonsRequested);
      } else {
        selected = filtered.slice(filtered.length - comparisonsRequested).reverse();
      }

      const totalViewports = 1 + selected.length;
      const layout = GRID_LAYOUTS[totalViewports];

      const previousState =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const previousViewports = getViewportsArray(previousState);
      const viewportsByPosition = new Map<string, any>();
      previousViewports.forEach(existing => {
        if (existing?.positionId) {
          viewportsByPosition.set(existing.positionId, existing);
        }
      });

      const cloneViewport = (source: any) => {
        if (!source) {
          return {};
        }

        return {
          displaySetInstanceUIDs: source.displaySetInstanceUIDs
            ? [...source.displaySetInstanceUIDs]
            : [],
          displaySetOptions: source.displaySetOptions
            ? Array.isArray(source.displaySetOptions)
              ? [...source.displaySetOptions]
              : { ...source.displaySetOptions }
            : [],
          viewportOptions: {
            ...(source.viewportOptions || {}),
          },
        };
      };

      const findOrCreateViewport = (position: number, positionId: string) => {
        const byPosition = viewportsByPosition.get(positionId);
        if (byPosition) {
          return cloneViewport(byPosition);
        }

        const byIndex = previousViewports[position];
        if (byIndex) {
          return cloneViewport(byIndex);
        }

        return {};
      };

      if (layout && viewportGridService.setLayout) {
        await viewportGridService.setLayout({
          ...layout,
          findOrCreateViewport,
        });
      }

      const latestState =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(latestState);

      if (!viewports.length) {
        setError('Unable to determine viewport positions after updating the layout.');
        return;
      }

      const assignments: Array<{ viewportId: string; displaySetInstanceUIDs: string[] }> = [];

      const primaryViewportId = viewports[0]?.viewportId;
      if (primaryViewportId) {
        assignments.push({
          viewportId: primaryViewportId,
          displaySetInstanceUIDs: [(activeDisplaySet as any).displaySetInstanceUID],
        });
      }

      selected.forEach((match, index) => {
        const viewport = viewports[index + 1];
        if (viewport?.viewportId) {
          assignments.push({
            viewportId: viewport.viewportId,
            displaySetInstanceUIDs: [match.displaySet.displaySetInstanceUID],
          });
        }
      });

      if (!assignments.length) {
        setError('No viewport assignments could be constructed.');
        return;
      }

      await viewportGridService.setDisplaySetsForViewports(assignments);

      if (displaySetService) {
        const patientUID = (activeDisplaySet as any)?.displaySetInstanceUID ?? null;
        if (patientUID) {
          setDisplaySetOrigin(displaySetService, patientUID, 'patient');
        }
        const comparisonUIDs = selected
          .map(match => match.displaySet?.displaySetInstanceUID)
          .filter(Boolean) as string[];
        if (comparisonUIDs.length) {
          setDisplaySetOrigin(displaySetService, comparisonUIDs, 'ai');
        }
      }

      setLastAppliedMatches(selected);
      setMatchPrompts({});
      loadPromptsForMatches(selected);
      clsPmapCacheRef.current.clear();
      clsAssignmentsRef.current.clear();
      assignments.forEach(item => {
        if (!item?.viewportId || !item.displaySetInstanceUIDs?.length) {
          return;
        }
        const baseDisplaySetUID = item.displaySetInstanceUIDs[0];
        try {
          const ds = displaySetService.getDisplaySetByUID(baseDisplaySetUID);
          const seriesUID =
            ds?.SeriesInstanceUID ??
            ds?.metadata?.SeriesInstanceUID ??
            ds?.getAttribute?.('SeriesInstanceUID') ??
            null;
          const description = getSeriesDescription(ds);
          clsAssignmentsRef.current.set(item.viewportId, {
            baseDisplaySetUID,
            baseSeriesInstanceUID: seriesUID ?? null,
            description,
          });
        } catch (assignmentError) {
          console.warn(
            'ExampleComponent: unable to resolve display set for CLS overlay mapping',
            assignmentError
          );
        }
      });
      setClsTargetsAvailable(clsAssignmentsRef.current.size > 0);
      setClsOverlaysVisible(false);

      const stateAfter =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewportsAfter = getViewportsArray(stateAfter);
      const firstViewport = viewportsAfter[0];
      if (firstViewport) {
        const cloneOptions = (options: any) => {
          if (!options) {
            return undefined;
          }
          if (Array.isArray(options)) {
            return options.map(option => ({ ...(option || {}) }));
          }
          if (typeof options === 'object') {
            return { ...options };
          }
          return options;
        };

        initialViewportRef.current = {
          displaySetInstanceUIDs: [...(firstViewport.displaySetInstanceUIDs || [])],
          displaySetOptions: cloneOptions(firstViewport.displaySetOptions),
          viewportOptions: { ...(firstViewport.viewportOptions || {}) },
        };
      }
    } catch (err) {
      console.error('ExampleComponent: Failed to apply example comparisons', err);
      setError('Failed to update viewports for the requested comparisons.');
    } finally {
      setIsApplying(false);
    }
  }, [
    viewportGridService,
    displaySetService,
    activeDisplaySet,
    seriesPrompt,
    comparisonMode,
    numComparisons,
    loadPromptsForMatches,
  ]);

  const handleResetExamples = useCallback(async () => {
    if (!viewportGridService) {
      return;
    }

    setError(null);
    setLastAppliedMatches([]);
    setMatchPrompts({});
    clsAssignmentsRef.current.clear();
    clsPmapCacheRef.current.clear();
    setClsTargetsAvailable(false);
    setClsOverlaysVisible(false);

    const initialViewport = initialViewportRef.current;

    if (!initialViewport || !initialViewport.displaySetInstanceUIDs?.length) {
      return;
    }

    try {
      const { displaySetInstanceUIDs, displaySetOptions, viewportOptions } = initialViewport;

      const cloneOptions = (options: any) => {
        if (!options) {
          return undefined;
        }
        if (Array.isArray(options)) {
          return options.map(option => ({ ...(option || {}) }));
        }
        if (typeof options === 'object') {
          return { ...options };
        }
        return options;
      };

      const findOrCreateViewport = () => ({
        displaySetInstanceUIDs: [...displaySetInstanceUIDs],
        displaySetOptions: cloneOptions(displaySetOptions),
        viewportOptions: { ...(viewportOptions || {}) },
      });

      await viewportGridService.setLayout({
        numCols: 1,
        numRows: 1,
        findOrCreateViewport,
      });

      const updatedState =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(updatedState);
      const primaryViewport = viewports[0];
      const targetViewportId = primaryViewport?.viewportId;

      if (targetViewportId) {
        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId: targetViewportId,
            displaySetInstanceUIDs: [...displaySetInstanceUIDs],
          },
        ]);

        if (viewportGridService.setActiveViewportId) {
          viewportGridService.setActiveViewportId(targetViewportId);
        }
      }
    } catch (resetError) {
      console.warn('ExampleComponent: Failed to restore original viewport state', resetError);
    }
  }, [viewportGridService]);

  const disableApplyButton =
    isApplying ||
    !viewportGridService ||
    !displaySetService ||
    !activeDisplaySet ||
    !seriesPrompt ||
    loadingPrompt;

  const findClsPmapDisplaySet = useCallback(
    (seriesUID: string | null) => {
      if (!seriesUID || !displaySetService) {
        return null;
      }

      const cached = clsPmapCacheRef.current.get(seriesUID);
      if (cached) {
        try {
          return displaySetService.getDisplaySetByUID(cached);
        } catch {
          clsPmapCacheRef.current.delete(seriesUID);
        }
      }

      const displaySets = displaySetService.getActiveDisplaySets?.() ?? [];
      for (const ds of displaySets) {
        if (!ds) {
          continue;
        }

        const sopClassUID = String(ds.SOPClassUID ?? '');
        if (sopClassUID !== PMAP_SOP_CLASS_UID) {
          continue;
        }

        const referencedUID = getReferencedSeriesInstanceUID(ds);
        if (referencedUID !== seriesUID) {
          continue;
        }

        const description = getSeriesDescription(ds);
        const tokens = tokenizeDescription(description);
        if (!tokens.includes('cls')) {
          continue;
        }

        clsPmapCacheRef.current.set(seriesUID, ds.displaySetInstanceUID);
        return ds;
      }

      return null;
    },
    [displaySetService]
  );

  const toggleClsOverlays = useCallback(async () => {
    if (!viewportGridService || !displaySetService) {
      return;
    }

    if (!clsAssignmentsRef.current.size) {
      uiNotificationService?.show?.({
        title: 'Overlay unavailable',
        message: 'Load examples first to enable entire prompt overlays.',
        type: 'info',
        duration: 2500,
      });
      return;
    }

    if (!hangingProtocolService) {
      uiNotificationService?.show?.({
        title: 'Service unavailable',
        message: 'Hanging protocol service is required to update viewports.',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    if (clsToggleBusy) {
      return;
    }

    setClsToggleBusy(true);

    try {
      const state =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const isHangingLayout =
        typeof state?.isHangingProtocolLayout === 'boolean'
          ? state.isHangingProtocolLayout
          : true;

      const updatesMap = new Map<string, any>();
      const missingSeries: string[] = [];
      const targetVisible = !clsOverlaysVisible;

      for (const [viewportId, info] of clsAssignmentsRef.current.entries()) {
        let targetDisplaySetUID: string | null = null;

        if (targetVisible) {
          const pmapDisplaySet = findClsPmapDisplaySet(info.baseSeriesInstanceUID);
          if (pmapDisplaySet) {
            targetDisplaySetUID = pmapDisplaySet.displaySetInstanceUID;
          } else {
            missingSeries.push(info.description || info.baseSeriesInstanceUID || viewportId);
            continue;
          }
        } else {
          targetDisplaySetUID = info.baseDisplaySetUID || null;
        }

        if (!targetDisplaySetUID) {
          continue;
        }

        let viewportUpdates: any[] = [];
        try {
          viewportUpdates =
            hangingProtocolService.getViewportsRequireUpdate?.(
              viewportId,
              targetDisplaySetUID,
              isHangingLayout
            ) ?? [];
        } catch (hpError) {
          console.warn(
            'ExampleComponent: hanging protocol update failed for viewport',
            viewportId,
            hpError
          );
        }

        if (!viewportUpdates.length) {
          viewportUpdates = [
            {
              viewportId,
              displaySetInstanceUIDs: [targetDisplaySetUID],
            },
          ];
        }

        viewportUpdates.forEach(update => updatesMap.set(update.viewportId, update));
      }

      if (!updatesMap.size) {
        if (targetVisible) {
          const message =
            missingSeries.length > 0
              ? `No CLS parametric maps found for: ${missingSeries.slice(0, 3).join(', ')}`
              : 'No CLS parametric maps available for the displayed series.';
          uiNotificationService?.show?.({
            title: 'Overlay unavailable',
            message,
            type: 'info',
            duration: 3000,
          });
        }
        setClsOverlaysVisible(false);
        return;
      }

      await viewportGridService.setDisplaySetsForViewports(Array.from(updatesMap.values()));
      if (targetVisible && missingSeries.length) {
        uiNotificationService?.show?.({
          title: 'Partial overlay',
          message: `CLS overlays applied, but missing for: ${missingSeries
            .slice(0, 3)
            .join(', ')}`,
          type: 'warning',
          duration: 4000,
        });
      }
      setClsOverlaysVisible(targetVisible);
    } catch (error) {
      console.error('ExampleComponent: failed to toggle CLS overlays', error);
      uiNotificationService?.show?.({
        title: 'Error',
        message: 'Unable to update viewports with CLS overlays.',
        type: 'error',
        duration: 3000,
      });
    } finally {
      setClsToggleBusy(false);
    }
  }, [
    clsOverlaysVisible,
    clsToggleBusy,
    displaySetService,
    findClsPmapDisplaySet,
    hangingProtocolService,
    uiNotificationService,
    viewportGridService,
  ]);

  return (
    <div className="border-primary-main flex h-full flex-col rounded-md border p-3">
      <div className="text-primary-light mb-2 text-xs uppercase tracking-wider">
        Similarity Examples
      </div>

      <div className="text-[13px] leading-snug text-white">
        <div className="mb-4 space-y-3">
          <div>
            <div className="text-aqua-pale mb-2 text-xs font-semibold">
              Number of comparison examples
            </div>
            <select
              value={numComparisons}
              onChange={event => handleNumComparisonsChange(event.target.value)}
              className="bg-primary-dark border-secondary-main w-full rounded-md border px-2 py-2 text-sm text-white"
              aria-label="Number of comparison examples"
            >
              {Array.from(
                { length: MAX_COMPARISONS - MIN_COMPARISONS + 1 },
                (_, idx) => MIN_COMPARISONS + idx
              ).map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-white">
              Choose how many additional series to display alongside the original viewport.
            </div>
          </div>

          <div>
            <div className="text-aqua-pale mb-2 text-xs font-semibold">Match preference</div>
            <div className="flex gap-2">
              {(['similar', 'dissimilar'] as ComparisonMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleComparisonModeChange(mode)}
                  className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                    comparisonMode === mode
                      ? 'bg-primary-main text-white'
                      : 'text-secondary-light bg-black'
                  }`}
                  aria-pressed={comparisonMode === mode}
                >
                  {mode === 'similar' ? 'Most similar' : 'Most dissimilar'}
                </button>
              ))}
            </div>
          </div>

          <div className="gap-2">
            <button
              type="button"
              onClick={applyExamples}
              disabled={disableApplyButton}
              className={`bg-primary-light mr-2 text-primary-dark rounded px-3 py-2 text-[14px] text-sm ${
                    disableApplyButton
                      ? 'text-white'
                      : 'text-secondary-light'
                  }`}
            >
              {isApplying ? 'Loading examples…' : 'Load examples into viewports'}
            </button>
            <button
              type="button"
              onClick={handleResetExamples}
              className="bg-primary-dark text-primary-light border-primary-light rounded border px-3 py-2 text-[14px] text-sm"
            >
              Reset
            </button>
          </div>

          <div>
            <button
              type="button"
              onClick={toggleClsOverlays}
              disabled={!clsTargetsAvailable || clsToggleBusy}
              className={`w-full rounded-md px-3 py-2 text-xs font-semibold transition-colors bg-primary-main text-white ${
                !clsTargetsAvailable || clsToggleBusy
                  ? 'bg-primary-dark text-white cursor-not-allowed'
                  : clsOverlaysVisible
                    ? 'bg-primary-main text-white hover:bg-aqua-pale'
                    : 'bg-black text-white border border-secondary-main hover:border-white hover:text-white'
              }`}
            >
              {clsOverlaysVisible ? 'Hide entire prompt overlays' : 'Show entire prompt overlays'}
            </button>
            {!clsTargetsAvailable && (
              <div className="mt-1 text-[11px] text-secondary-light">
                Load examples to enable CLS overlays.
              </div>
            )}
          </div>
        </div>

        <div className="mb-3">
          <div className="text-primary-light mb-1 text-[11px] uppercase tracking-wide">
            Series prompt
          </div>
          <div className="bg-primary-dark max-h-32 overflow-auto rounded-md p-2 text-[12px]">
            {loadingPrompt && <span className="text-secondary-light">Retrieving prompt…</span>}
            {!loadingPrompt && seriesPrompt && (
              <pre className="whitespace-pre-wrap">{seriesPrompt}</pre>
            )}
            {!loadingPrompt && !seriesPrompt && (
              <span className="text-secondary-light">
                No prompt metadata found for the active series.
              </span>
            )}
          </div>
        </div>

        {error && <div className="text-error-light mb-2 text-xs">{error}</div>}

        {!error && lastAppliedMatches.length > 0 && (
          <div className="border-primary-dark mt-2 border-t pt-2 text-[12px]">
            <div className="text-primary-light mb-1 text-[11px] uppercase tracking-wide">
              Loaded comparisons
            </div>
            <ul className="space-y-1">
              {lastAppliedMatches.map(match => (
                <li
                  key={match.displaySet.displaySetInstanceUID}
                  className="bg-primary-dark rounded-md px-2 py-2"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate pr-2">
                      {match.displaySet.SeriesDescription || 'Untitled series'}
                    </span>
                    <span className="text-secondary-light text-[11px]">
                      {(match.score || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-primary-light whitespace-pre-wrap text-[11px] leading-snug">
                    {(() => {
                      const prompt = matchPrompts[match.displaySet.displaySetInstanceUID];
                      if (prompt !== undefined) {
                        return prompt || 'No prompt metadata found.';
                      }
                      return loadingMatchPrompts
                        ? 'Loading prompt metadata…'
                        : 'Prompt metadata unavailable.';
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExampleComponent;
