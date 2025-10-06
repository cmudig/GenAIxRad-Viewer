import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';
import { rankDisplaySetsByPrompt, RankedDisplaySet } from './similarity';

type ExampleComponentProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type ComparisonMode = 'similar' | 'dissimilar';

const MIN_COMPARISONS = 2;
const MAX_COMPARISONS = 5;

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

const ExampleComponent: React.FC<ExampleComponentProps> = ({ servicesManager }) => {
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;

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
  }, [seriesInstanceUID]);

  const handleComparisonModeChange = useCallback((mode: ComparisonMode) => {
    setComparisonMode(mode);
  }, []);

  const handleNumComparisonsChange = useCallback((value: number) => {
    const clamped = Math.max(MIN_COMPARISONS, Math.min(MAX_COMPARISONS, Math.round(value)));
    setNumComparisons(clamped);
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
        const isSameDisplaySet =
          candidateUID === (activeDisplaySet as any)?.displaySetInstanceUID;

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

      setLastAppliedMatches(selected);
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
  ]);

  const disableApplyButton =
    isApplying ||
    !viewportGridService ||
    !displaySetService ||
    !activeDisplaySet ||
    !seriesPrompt ||
    loadingPrompt;

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
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={MIN_COMPARISONS}
                max={MAX_COMPARISONS}
                step={1}
                value={numComparisons}
                onChange={event => handleNumComparisonsChange(Number(event.target.value))}
                className="flex-1"
                aria-label="Number of comparison examples"
              />
              <div className="w-6 text-right text-sm font-semibold">{numComparisons}</div>
            </div>
            <div className="text-secondary-light mt-1 text-[11px]">
              Select between {MIN_COMPARISONS} and {MAX_COMPARISONS} additional series to compare
              against the current viewport.
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

          <button
            type="button"
            onClick={applyExamples}
            disabled={disableApplyButton}
            className={`w-full rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              disableApplyButton
                ? 'bg-primary-dark text-secondary-light cursor-not-allowed'
                : 'bg-aqua-pale text-black hover:bg-white'
            }`}
          >
            {isApplying ? 'Loading examples…' : 'Load examples into viewports'}
          </button>
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
            <div className="text-secondary-light mb-1 text-[11px] uppercase tracking-wide">
              Loaded comparisons
            </div>
            <ul className="space-y-1">
              {lastAppliedMatches.map(match => (
                <li
                  key={match.displaySet.displaySetInstanceUID}
                  className="bg-primary-dark flex items-center justify-between rounded-md px-2 py-1"
                >
                  <span className="truncate pr-2">
                    {match.displaySet.SeriesDescription || 'Untitled series'}
                  </span>
                  <span className="text-secondary-light text-[11px]">
                    {(match.score || 0).toFixed(2)}
                  </span>
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
