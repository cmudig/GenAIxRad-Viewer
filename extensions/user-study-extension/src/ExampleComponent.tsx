import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { rankDisplaySetsByPrompt, RankedDisplaySet } from './similarity';
import { setDisplaySetOrigin } from './utils/displaySetOrigin';

type ExampleComponentProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

const GRID_LAYOUTS: Record<number, { numCols: number; numRows: number }> = {
  1: { numCols: 1, numRows: 1 },
  2: { numCols: 2, numRows: 1 },
  3: { numCols: 3, numRows: 1 },
  4: { numCols: 2, numRows: 2 },
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

const ExampleComponent: React.FC<ExampleComponentProps> = ({ servicesManager }) => {
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;
  const uiNotificationService =
    servicesManager?.services?.uiNotificationService ||
    servicesManager?.services?.UINotificationService;

  const [activeViewportId, setActiveViewportId] = useState<string | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [activeDisplaySetUID, setActiveDisplaySetUID] = useState<string | null>(null);

  const initialViewportRef = useRef<
    | null
    | {
        displaySetInstanceUIDs: string[];
        displaySetOptions?: any;
        viewportOptions?: any;
      }
  >(null);

  const [similarMatches, setSimilarMatches] = useState<RankedDisplaySet[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [similarError, setSimilarError] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const captureInitialViewport = () => {
      if (initialViewportRef.current) {
        return;
      }

      const state =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(state);
      if (!viewports.length) {
        return;
      }

      const firstViewport = viewports[0];
      if (!firstViewport?.displaySetInstanceUIDs?.length) {
        return;
      }

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
        displaySetInstanceUIDs: [...firstViewport.displaySetInstanceUIDs],
        displaySetOptions: cloneOptions(firstViewport.displaySetOptions),
        viewportOptions: { ...(firstViewport.viewportOptions || {}) },
      };
    };

    captureInitialViewport();

    const sub =
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.VIEWPORTS_READY || 'event::viewportsReady',
        captureInitialViewport
      ) || null;

    return () => sub?.unsubscribe?.();
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

  const [patientDisplaySet, setPatientDisplaySet] = useState<any>(null);

  useEffect(() => {
    if (activeDisplaySet && !patientDisplaySet) {
      setPatientDisplaySet(activeDisplaySet);
    }
  }, [activeDisplaySet, patientDisplaySet]);

  useEffect(() => {
    const handleReset = () => setPatientDisplaySet(null);
    document.addEventListener('examplesReset', handleReset);
    return () => document.removeEventListener('examplesReset', handleReset);
  }, []);

  const promptText = useMemo(
    () => (patientDisplaySet ? (getSeriesDescription(patientDisplaySet) || '').trim() : ''),
    [patientDisplaySet]
  );

  const computeMatches = useCallback(async () => {
    if (!displaySetService || !promptText || !patientDisplaySet) {
      return [];
    }

    const allDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];
    if (!allDisplaySets.length) {
      return [];
    }

    const ranked = rankDisplaySetsByPrompt(allDisplaySets, promptText, {
      promptContext: {
        modality: (patientDisplaySet as any)?.Modality,
        bodyPart: (patientDisplaySet as any)?.BodyPartExamined,
      },
    });

    const patientUID = (patientDisplaySet as any)?.displaySetInstanceUID ?? activeDisplaySetUID;
    const patientModality = String((patientDisplaySet as any)?.Modality || '').toUpperCase();

    const filtered = ranked.filter(item => {
      const candidateUID = item.displaySet.displaySetInstanceUID;
      const candidateModality = String(item.displaySet.Modality || '').toUpperCase();

      if (!candidateUID || candidateUID === patientUID) {
        return false;
      }

      if (candidateModality === 'PMAP') {
        return false;
      }

      if (patientModality) {
        return candidateModality === patientModality;
      }

      return candidateModality === 'AI';
    });

    return filtered.slice(0, 3);
  }, [displaySetService, promptText, patientDisplaySet, activeDisplaySetUID]);

  useEffect(() => {
    let cancelled = false;

    const loadSimilar = async () => {
      if (!promptText) {
        setSimilarMatches([]);
        setSimilarError('No description available for the current case.');
        return;
      }

      setLoadingSimilar(true);
      setSimilarError('');

      try {
        const matches = await computeMatches();
        if (!cancelled) {
          setSimilarMatches(matches);
          if (!matches.length) {
            setSimilarError('No similar cases available yet.');
          }
        }
      } catch (err) {
        console.error('ExampleComponent: failed to load similar cases', err);
        if (!cancelled) {
          setSimilarMatches([]);
          setSimilarError('Unable to load similar cases. Try again shortly.');
        }
      } finally {
        if (!cancelled) {
          setLoadingSimilar(false);
        }
      }
    };

    loadSimilar();

    return () => {
      cancelled = true;
    };
  }, [computeMatches, promptText]);

  const ensureMatches = useCallback(async () => {
    if (similarMatches.length) {
      return similarMatches;
    }
    const matches = await computeMatches();
    setSimilarMatches(matches);
    return matches;
  }, [computeMatches, similarMatches]);

  const addMatchToViewport = useCallback(
    async (match: RankedDisplaySet) => {
      if (!viewportGridService) {
        return;
      }

      const matchUID = match?.displaySet?.displaySetInstanceUID;
      if (!matchUID) {
        uiNotificationService?.show?.({
          title: 'Series unavailable',
          message: 'This similar case cannot be loaded right now.',
          type: 'warning',
          duration: 2500,
        });
        return;
      }

      try {
        const state =
          viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
        const previousViewports = getViewportsArray(state);

        const layout = state?.layout ?? {};
        const layoutCols = Number(layout?.numCols) || 0;
        const layoutRows = Number(layout?.numRows) || 0;
        const layoutViewportCount =
          layoutCols > 0 && layoutRows > 0 ? layoutCols * layoutRows : 0;
        const existingViewportCount = Math.max(
          previousViewports.length,
          layoutViewportCount,
          1
        );

        if (existingViewportCount >= 4) {
          uiNotificationService?.show?.({
            title: 'Viewport limit reached',
            message: 'Close a similar case before loading another.',
            type: 'info',
            duration: 3000,
          });
          return;
        }

        const targetCount = Math.min(4, existingViewportCount + 1);
        const layoutConfig = GRID_LAYOUTS[targetCount];
        if (!layoutConfig) {
          uiNotificationService?.show?.({
            title: 'Layout unavailable',
            message: 'Unable to create space for another viewport.',
            type: 'error',
            duration: 3000,
          });
          return;
        }

        const previousViewportIds = new Set(
          previousViewports.map(v => v?.viewportId).filter(Boolean)
        );

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

        await viewportGridService.setLayout({
          ...layoutConfig,
          findOrCreateViewport,
        });

        const updatedState =
          viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
        const updatedViewports = getViewportsArray(updatedState);
        const newViewport =
          updatedViewports.find(v => !previousViewportIds.has(v?.viewportId)) ??
          updatedViewports[updatedViewports.length - 1];

        if (!newViewport?.viewportId) {
          throw new Error('Unable to allocate a viewport for the similar case.');
        }

        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId: newViewport.viewportId,
            displaySetInstanceUIDs: [matchUID],
          },
        ]);

        viewportGridService.setActiveViewportId?.(newViewport.viewportId);
        if (displaySetService && matchUID) {
          setDisplaySetOrigin(displaySetService, [matchUID], 'ai');
        }
      } catch (err) {
        console.error('ExampleComponent: failed to display similar case', err);
        uiNotificationService?.show?.({
          title: 'Unable to display case',
          message: 'Please try again in a moment.',
          type: 'error',
          duration: 3000,
        });
      }
    },
    [viewportGridService, displaySetService, uiNotificationService]
  );

  const replaceMatchInViewport = useCallback(
    async (match: RankedDisplaySet) => {
      if (!viewportGridService) {
        return;
      }

      const matchUID = match?.displaySet?.displaySetInstanceUID;
      if (!matchUID) {
        uiNotificationService?.show?.({
          title: 'Series unavailable',
          message: 'This similar case cannot be loaded right now.',
          type: 'warning',
          duration: 2500,
        });
        return;
      }

      try {
        const state =
          viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
        const viewports = getViewportsArray(state);
        const targetViewportId =
          state?.activeViewportId ?? activeViewportId ?? viewports[0]?.viewportId ?? null;

        if (!targetViewportId) {
          throw new Error('No active viewport available.');
        }

        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId: targetViewportId,
            displaySetInstanceUIDs: [matchUID],
          },
        ]);

        viewportGridService.setActiveViewportId?.(targetViewportId);
        if (displaySetService) {
          setDisplaySetOrigin(displaySetService, [matchUID], 'ai');
        }
      } catch (err) {
        console.error('ExampleComponent: failed to replace viewport', err);
        uiNotificationService?.show?.({
          title: 'Unable to display case',
          message: 'Please try again in a moment.',
          type: 'error',
          duration: 3000,
        });
      }
    },
    [viewportGridService, displaySetService, uiNotificationService, activeViewportId]
  );

  const handleShowAll = useCallback(async () => {
    if (!viewportGridService || !displaySetService) {
      setError('Viewport services are unavailable.');
      return;
    }

    if (!activeDisplaySet) {
      setError('Open a study in the viewport to compare similar cases.');
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const matches = await ensureMatches();
      if (!matches.length) {
        setError('No similar cases were found for the current study.');
        return;
      }

      const totalViewports = Math.min(4, 1 + matches.length);
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
      const patientUID = (activeDisplaySet as any)?.displaySetInstanceUID;

      if (primaryViewportId && patientUID) {
        assignments.push({
          viewportId: primaryViewportId,
          displaySetInstanceUIDs: [patientUID],
        });
      }

      matches.slice(0, totalViewports - 1).forEach((match, index) => {
        const viewport = viewports[index + 1];
        const matchUID = match.displaySet?.displaySetInstanceUID;
        if (viewport?.viewportId && matchUID) {
          assignments.push({
            viewportId: viewport.viewportId,
            displaySetInstanceUIDs: [matchUID],
          });
        }
      });

      if (!assignments.length) {
        setError('No viewport assignments could be constructed.');
        return;
      }

      await viewportGridService.setDisplaySetsForViewports(assignments);

      if (displaySetService) {
        if (patientUID) {
          setDisplaySetOrigin(displaySetService, patientUID, 'patient');
        }
        const comparisonUIDs = matches
          .map(match => match.displaySet?.displaySetInstanceUID)
          .filter(Boolean) as string[];
        if (comparisonUIDs.length) {
          setDisplaySetOrigin(displaySetService, comparisonUIDs, 'ai');
        }
      }
    } catch (err) {
      console.error('ExampleComponent: Failed to arrange similar cases', err);
      setError('Failed to load similar cases into the viewport grid.');
    } finally {
      setIsApplying(false);
    }
  }, [viewportGridService, displaySetService, activeDisplaySet, ensureMatches]);

  const handleResetViewports = useCallback(async () => {
    if (!viewportGridService) {
      return;
    }

    const initialViewport = initialViewportRef.current;
    if (!initialViewport?.displaySetInstanceUIDs?.length) {
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

        viewportGridService.setActiveViewportId?.(targetViewportId);
      }
    } catch (resetError) {
      console.warn('ExampleComponent: Failed to restore original viewport state', resetError);
    }
  }, [viewportGridService]);

  const cardsAvailable = similarMatches.length > 0;
  const currentDescription =
    patientDisplaySet && promptText
      ? promptText
      : 'No description available for the patient CT scan.';

  return (
    <div className="flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg shadow-primary-main/10">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/60">
            Similar Cases
          </p>
          <p className="text-sm text-white/80">
            Search for examples from the database that have related impressions.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleShowAll}
            disabled={isApplying || loadingSimilar || !cardsAvailable}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              isApplying || loadingSimilar || !cardsAvailable
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-primary-light text-black hover:bg-white'
            }`}
          >
            {isApplying ? 'Loading…' : 'Show All'}
          </button>
          <button
            type="button"
            onClick={handleResetViewports}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:border-white/60 hover:text-white"
          >
            Reset Viewport
          </button>
        </div>
      </div>

      {similarError && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          {similarError}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl bg-[#42182c] px-3 py-2 text-sm text-error-light">{error}</div>
      )}

      <div className="ohif-scrollbar mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        <CaseCard title="Patient CT Scan" body={currentDescription} />

        {similarMatches.map((match, index) => (
          <CaseCard
            key={match.displaySet.displaySetInstanceUID ?? `match-${index}`}
            title={`Similar Case #${index + 1}`}
            body={getSeriesDescription(match.displaySet) || 'Untitled series'}
            primaryActionLabel="Add to viewport"
            primaryAction={() => addMatchToViewport(match)}
            secondaryActionLabel="Replace current"
            secondaryAction={() => replaceMatchInViewport(match)}
          />
        ))}

        {!loadingSimilar && !similarMatches.length && (
          <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/70">
            No similar cases available yet. Load another study or refresh the viewer.
          </div>
        )}
      </div>
    </div>
  );
};

type CaseCardProps = {
  title: string;
  body: string;
  primaryActionLabel?: string;
  primaryAction?: () => void;
  secondaryActionLabel?: string;
  secondaryAction?: () => void;
};

const CaseCard: React.FC<CaseCardProps> = ({
  title,
  body,
  primaryActionLabel,
  primaryAction,
  secondaryActionLabel,
  secondaryAction,
}) => (
  <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{title}</div>
    <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">{body}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {primaryActionLabel && primaryAction && (
        <button
          type="button"
          onClick={primaryAction}
          className="rounded-full bg-primary-light px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white"
        >
          {primaryActionLabel}
        </button>
      )}
      {secondaryActionLabel && secondaryAction && (
        <button
          type="button"
          onClick={secondaryAction}
          className="rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:border-white hover:text-white"
        >
          {secondaryActionLabel}
        </button>
      )}
    </div>
  </div>
);

export default ExampleComponent;
