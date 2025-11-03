import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRenderingEngine, StackViewport, VolumeViewport } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';
import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';

const PMAP_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.30';
const PMAP_STATE_KEY = 'pmap_visibility_state';
const ORIGINAL_DS_UID_KEY = 'original_display_set_uid';

const safeSession = {
  get: (key: string) => {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null;
    }
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return;
    }
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* ignore session storage failures */
    }
  },
  remove: (key: string) => {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return;
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore session storage failures */
    }
  },
};

type WordEntry = {
  original: string;
  normalized: string;
};

type ViewportState = {
  imageIndex?: number;
  voiRange?: { lower: number; upper: number };
  colormap?: Record<string, unknown>;
} | null;

const normalizeWord = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const tokenizeDescription = (description: string): string[] => {
  const normalized = normalizeWord(description);
  const tokens = new Set<string>();

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
    displaySet.getAttribute?.('SeriesDescription') ??
    displaySet.metadata?.SeriesDescription ??
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
    displaySet.getAttribute?.('ReferencedSeriesInstanceUID') ??
    displaySet.metadata?.ReferencedSeriesInstanceUID ??
    null
  );
};

const getSeriesPromptFromDisplaySet = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }

  const prompt =
    displaySet.SeriesPrompt ??
    displaySet.seriesPrompt ??
    displaySet.metadata?.SeriesPrompt ??
    displaySet.getAttribute?.('SeriesPrompt') ??
    null;

  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt;
  }

  return null;
};

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  const { viewports } = state;

  if (Array.isArray(viewports)) {
    return viewports;
  }

  if (typeof viewports.values === 'function') {
    return Array.from(viewports.values());
  }

  if (typeof viewports === 'object') {
    return Object.values(viewports);
  }

  return [];
};

const getViewportEntryById = (state: any, viewportId: string | null | undefined) => {
  if (!viewportId || !state?.viewports) {
    return null;
  }

  const { viewports } = state;

  if (typeof viewports.get === 'function') {
    return viewports.get(viewportId) ?? null;
  }

  if (Array.isArray(viewports)) {
    return viewports.find(viewport => viewport?.viewportId === viewportId) ?? null;
  }

  if (typeof viewports === 'object') {
    return viewports[viewportId] ?? null;
  }

  return null;
};

const captureViewportState = (viewport: any): ViewportState => {
  if (!viewport) {
    return null;
  }

  const currentIndex = viewport.getCurrentImageIdIndex?.();

  const state: ViewportState = {};

  if (currentIndex !== undefined && !Number.isNaN(currentIndex)) {
    state.imageIndex = currentIndex;
  }

  if (viewport instanceof StackViewport) {
    const properties = viewport.getProperties?.();
    state.voiRange = properties?.voiRange;
    state.colormap = properties?.colormap;
  } else if (viewport instanceof VolumeViewport) {
    const volumeId = viewport.getVolumeId?.();
    if (volumeId) {
      const properties = viewport.getProperties?.(volumeId);
      state.voiRange = properties?.voiRange;
      state.colormap = properties?.colormap;
    }
  }

  return state;
};

const setInitialImageOverrides = (viewportsToUpdate: any[], viewportState: ViewportState) => {
  if (!viewportState || viewportState.imageIndex === undefined) {
    return viewportsToUpdate;
  }

  const { imageIndex } = viewportState;
  if (!Number.isFinite(imageIndex)) {
    return viewportsToUpdate;
  }

  return viewportsToUpdate.map(viewportUpdate => {
    const existingViewportOptions = viewportUpdate.viewportOptions || {};
    const existingInitialImageOptions = existingViewportOptions.initialImageOptions || {};

    return {
      ...viewportUpdate,
      viewportOptions: {
        ...existingViewportOptions,
        initialImageOptions: {
          ...existingInitialImageOptions,
          index: imageIndex,
          useOnce: true,
        },
      },
    };
  });
};

const restoreViewportState = (viewportId: string, viewportState: ViewportState) => {
  if (!viewportState) {
    return;
  }

  const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
  if (!renderingEngine) {
    return;
  }

  const viewport = renderingEngine.getViewport(viewportId);
  if (!viewport) {
    return;
  }

  if (viewportState.imageIndex !== undefined) {
    const numberOfSlices = viewport.getNumberOfSlices?.();
    const maxIndex = typeof numberOfSlices === 'number' ? numberOfSlices - 1 : null;
    let targetIndex = viewportState.imageIndex;

    if (maxIndex !== null && maxIndex >= 0) {
      targetIndex = Math.max(0, Math.min(targetIndex, maxIndex));
    }

    if (Number.isFinite(targetIndex)) {
      jumpToSlice(viewport.element, { imageIndex: targetIndex });
    }
  }

  const applyProperties = (properties: Record<string, unknown>) => {
    if (viewport instanceof StackViewport) {
      viewport.setProperties(properties);
    } else if (viewport instanceof VolumeViewport) {
      const volumeId = viewport.getVolumeId?.();
      if (volumeId) {
        viewport.setProperties(properties, volumeId);
      } else {
        viewport.setProperties(properties);
      }
    } else {
      viewport.setProperties?.(properties);
    }
  };

  const propertiesToApply: Record<string, unknown> = {};

  if (viewportState.voiRange) {
    propertiesToApply.voiRange = viewportState.voiRange;
  }

  if (viewportState.colormap) {
    propertiesToApply.colormap = viewportState.colormap;
  }

  if (Object.keys(propertiesToApply).length) {
    applyProperties(propertiesToApply);
  }

  viewport.render?.();
};

const waitForViewportVolumes = (cornerstoneViewportService: any, viewportId: string) => {
  if (!cornerstoneViewportService || !viewportId) {
    return Promise.resolve();
  }

  return new Promise<void>(resolve => {
    let resolved = false;
    let timeoutId: number | undefined;
    let unsubscribe: (() => void) | undefined;

    const cleanup = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      unsubscribe?.();
      resolve();
    };

    timeoutId = window.setTimeout(cleanup, 750);

    const subscription = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS?.VIEWPORT_VOLUMES_CHANGED || 'VIEWPORT_VOLUMES_CHANGED',
      ({ viewportInfo }) => {
        if (viewportInfo?.viewportId === viewportId) {
          cleanup();
        }
      }
    );

    unsubscribe = subscription?.unsubscribe;

    if (!subscription) {
      cleanup();
    }
  });
};

function RadiopaediaComponent({ servicesManager }: any) {
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;
  const hangingProtocolService =
    servicesManager?.services?.hangingProtocolService ||
    servicesManager?.services?.HangingProtocolService;
  const cornerstoneViewportService =
    servicesManager?.services?.cornerstoneViewportService ||
    servicesManager?.services?.CornerstoneViewportService;
  const uiNotificationService =
    servicesManager?.services?.uiNotificationService ||
    servicesManager?.services?.UINotificationService;

  const [activeViewportId, setActiveViewportId] = useState<string | null>(null);
  const [activeDisplaySetUID, setActiveDisplaySetUID] = useState<string | null>(null);
  const [seriesInstanceUID, setSeriesInstanceUID] = useState<string | null>(null);
  const [seriesPrompt, setSeriesPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState<boolean>(false);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [displaySetsVersion, setDisplaySetsVersion] = useState(0);

  const busyRef = useRef(false);
  const originalDisplaySetRef = useRef<Map<string, string>>(new Map());
  const lastBaseIdentityRef = useRef<string | null>(null);

  const setBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setIsBusy(value);
  }, []);

  const syncFromViewportState = useCallback(() => {
    if (!viewportGridService) {
      return;
    }

    const state =
      viewportGridService.getState?.() || viewportGridService.getViewportGridState?.() || {};

    const viewports = getViewportsArray(state);
    const resolvedActiveId = state?.activeViewportId ?? viewports[0]?.viewportId ?? null;

    setActiveViewportId(prev => (prev === resolvedActiveId ? prev : resolvedActiveId));

    const activeViewport =
      viewports.find(viewport => viewport?.viewportId === resolvedActiveId) ?? viewports[0] ?? null;

    const candidateUID =
      activeViewport?.displaySetInstanceUIDs?.[0] ||
      activeViewport?.displaySetOptions?.displaySetInstanceUIDs?.[0] ||
      null;

    if (candidateUID) {
      setActiveDisplaySetUID(prev => (prev === candidateUID ? prev : candidateUID));
      return;
    }

    if (displaySetService?.getActiveDisplaySets) {
      const activeDisplaySets = displaySetService.getActiveDisplaySets() ?? [];
      if (activeDisplaySets.length) {
        const fallback = activeDisplaySets[0]?.displaySetInstanceUID ?? null;
        setActiveDisplaySetUID(prev => (prev === fallback ? prev : fallback));
        return;
      }
    }

    setActiveDisplaySetUID(prev => (prev === null ? prev : null));
  }, [displaySetService, viewportGridService]);

  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    syncFromViewportState();

    const subscriptions = [
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
        syncFromViewportState
      ),
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
        syncFromViewportState
      ),
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.VIEWPORTS_READY || 'VIEWPORTS_READY',
        syncFromViewportState
      ),
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.LAYOUT_CHANGED || 'LAYOUT_CHANGED',
        syncFromViewportState
      ),
    ].filter(Boolean);

    return () => subscriptions.forEach(sub => sub?.unsubscribe?.());
  }, [syncFromViewportState, viewportGridService]);

  useEffect(() => {
    if (!displaySetService) {
      return;
    }

    const bumpVersion = () => setDisplaySetsVersion(current => current + 1);

    const onAdded = () => {
      syncFromViewportState();
      bumpVersion();
    };

    const subscriptions = [
      displaySetService.subscribe?.(
        displaySetService.EVENTS?.DISPLAY_SETS_ADDED || 'DISPLAY_SETS_ADDED',
        onAdded
      ),
      displaySetService.subscribe?.(
        displaySetService.EVENTS?.DISPLAY_SETS_CHANGED || 'DISPLAY_SETS_CHANGED',
        bumpVersion
      ),
      displaySetService.subscribe?.(
        displaySetService.EVENTS?.DISPLAY_SETS_REMOVED || 'DISPLAY_SETS_REMOVED',
        bumpVersion
      ),
    ].filter(Boolean);

    return () => subscriptions.forEach(sub => sub?.unsubscribe?.());
  }, [displaySetService, syncFromViewportState]);

  const activeDisplaySet = useMemo(() => {
    if (!activeDisplaySetUID || !displaySetService) {
      return null;
    }

    try {
      return displaySetService.getDisplaySetByUID(activeDisplaySetUID);
    } catch {
      return null;
    }
  }, [activeDisplaySetUID, displaySetService]);

  useEffect(() => {
    const ds: any = activeDisplaySet;

    if (!ds) {
      setSeriesInstanceUID(null);
      return;
    }

    const sopClassUID = String(ds?.SOPClassUID ?? '');
    if (sopClassUID === PMAP_SOP_CLASS_UID) {
      const referenced = getReferencedSeriesInstanceUID(ds);
      setSeriesInstanceUID(referenced ?? null);
      return;
    }

    const uid =
      ds.SeriesInstanceUID ??
      ds?.metadata?.SeriesInstanceUID ??
      ds?.getAttribute?.('SeriesInstanceUID') ??
      null;

    setSeriesInstanceUID(uid ?? null);
  }, [activeDisplaySet]);

  useEffect(() => {
    if (!activeDisplaySet) {
      return;
    }

    const prompt = getSeriesPromptFromDisplaySet(activeDisplaySet);
    if (prompt) {
      setSeriesPrompt(prompt);
      setPromptError(null);
    }
  }, [activeDisplaySet]);

  useEffect(() => {
    if (!activeViewportId) {
      return;
    }

    const ds: any = activeDisplaySet;
    const sopClassUID = String(ds?.SOPClassUID ?? '');

    if (sopClassUID === PMAP_SOP_CLASS_UID) {
      return;
    }

    const displaySetInstanceUID = ds?.displaySetInstanceUID ?? activeDisplaySetUID;
    if (!displaySetInstanceUID) {
      return;
    }

    const identity = `${activeViewportId}::${displaySetInstanceUID}`;

    if (identity === lastBaseIdentityRef.current) {
      return;
    }

    lastBaseIdentityRef.current = identity;
    setSelectedWord(null);
    originalDisplaySetRef.current.delete(activeViewportId);
    safeSession.remove(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`);
    safeSession.set(`${PMAP_STATE_KEY}_${activeViewportId}`, 'false');
  }, [activeDisplaySet, activeDisplaySetUID, activeViewportId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPrompt() {
      if (!seriesInstanceUID) {
        setSeriesPrompt(null);
        setPromptError(null);
        return;
      }

      setIsLoadingPrompt(true);
      setPromptError(null);

      try {
        const prompt = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPrompt');
        if (!cancelled) {
          const promptText = typeof prompt === 'string' && prompt.trim() ? prompt : null;
          setSeriesPrompt(prev => promptText ?? prev ?? null);
          if (!promptText) {
            setPromptError(prev => prev ?? 'No prompt metadata found for this series.');
          } else {
            setPromptError(null);
          }
        }
      } catch (error) {
        console.warn('Prompt tab: failed to load SeriesPrompt metadata', error);
        if (!cancelled) {
          setSeriesPrompt(prev => prev ?? null);
          setPromptError(prev => prev ?? 'Unable to load prompt metadata for this series.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPrompt(false);
        }
      }
    }

    loadPrompt();

    return () => {
      cancelled = true;
    };
  }, [seriesInstanceUID]);

  const promptWords = useMemo<WordEntry[]>(() => {
    if (!seriesPrompt) {
      return [];
    }

    const seen = new Set<string>();
    const entries: WordEntry[] = [];

    seriesPrompt
      .split(/\s+/)
      .map(word => word.trim())
      .filter(Boolean)
      .forEach(original => {
        const normalized = normalizeWord(original);
        if (!normalized || seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        entries.push({ original, normalized });
      });

    return entries;
  }, [seriesPrompt]);

  const pmapDisplaySetsByWord = useMemo(() => {
    const map = new Map<string, any[]>();

    if (!displaySetService || !seriesInstanceUID) {
      return map;
    }

    const baseStudyInstanceUID =
      activeDisplaySet?.StudyInstanceUID ??
      activeDisplaySet?.metadata?.StudyInstanceUID ??
      activeDisplaySet?.getAttribute?.('StudyInstanceUID') ??
      null;

    const cache = displaySetService.getDisplaySetCache?.();
    const cachedDisplaySets = cache ? Array.from(cache.values()) : [];
    const activeDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];
    const allDisplaySets = cachedDisplaySets.length ? cachedDisplaySets : activeDisplaySets;

    let totalCandidateSeries = 0;

    allDisplaySets.forEach(ds => {
      if (!ds) {
        return;
      }

      if (
        baseStudyInstanceUID &&
        ((ds as any).StudyInstanceUID ??
          ds?.metadata?.StudyInstanceUID ??
          ds?.getAttribute?.('StudyInstanceUID') ??
          null) !== baseStudyInstanceUID
      ) {
        return;
      }

      const description = String(getSeriesDescription(ds) || '').trim();
      if (!description) {
        return;
      }

      const tokens = tokenizeDescription(description);
      if (!tokens.length) {
        return;
      }

      tokens.forEach(token => {
        if (!map.has(token)) {
          map.set(token, []);
        }
        map.get(token)!.push(ds);
      });

      totalCandidateSeries += 1;
    });

    console.log('[Prompt words] Indexed study series', {
      seriesInstanceUID,
      totalCandidateSeries,
      tokenBuckets: map.size,
      tokens: Array.from(map.keys()),
    });

    return map;
  }, [activeDisplaySet, displaySetService, seriesInstanceUID, displaySetsVersion]);

  const displayWords = useMemo<WordEntry[]>(() => {
    const ordered: WordEntry[] = [];
    const seen = new Set<string>();

    const clsCandidates = pmapDisplaySetsByWord.get('cls');
    if (clsCandidates?.length) {
      ordered.push({ original: 'Entire prompt', normalized: 'cls' });
      seen.add('cls');
    }

    promptWords.forEach(word => {
      if (!seen.has(word.normalized)) {
        ordered.push(word);
        seen.add(word.normalized);
      }
    });

    return ordered;
  }, [pmapDisplaySetsByWord, promptWords]);

  const findPmapDisplaySetForWord = useCallback(
    (word: WordEntry) => {
      const candidates = pmapDisplaySetsByWord.get(word.normalized);
      if (!candidates?.length) {
        console.warn('[Prompt words] No candidate probability maps found', {
          word: word.original,
          normalized: word.normalized,
          seriesInstanceUID,
        });
        return null;
      }

      const prioritize = (list: any[]) => {
        const withProbability = list.filter(candidate => {
          const description = String(getSeriesDescription(candidate) || '');
          return /probability\s+map/i.test(description);
        });

        if (withProbability.length) {
          return withProbability;
        }
        return list;
      };

      const prioritized = prioritize(candidates);

      const exact =
        prioritized.find(candidate => {
          const description = String(getSeriesDescription(candidate) || '');
          return normalizeWord(description) === word.normalized;
        }) ?? null;

      const chosen = exact ?? prioritized[0];

      console.log('[Prompt words] Matched series for word', {
        word: word.original,
        normalized: word.normalized,
        chosenSeriesDescription: String(getSeriesDescription(chosen) || ''),
        chosenDisplaySetUID: chosen?.displaySetInstanceUID,
        totalCandidates: candidates.length,
        prioritizedCount: prioritized.length,
        matchType: exact ? 'exact' : 'first-priority',
      });

      return chosen;
    },
    [pmapDisplaySetsByWord]
  );

  const showPmapForDisplaySet = useCallback(
    async (word: WordEntry, pmapDisplaySet: any) => {
      if (!viewportGridService) {
        uiNotificationService?.show?.({
          title: 'Error',
          message: 'Viewport service is unavailable.',
          type: 'error',
          duration: 3000,
        });
        return;
      }

      if (!pmapDisplaySet?.displaySetInstanceUID) {
        uiNotificationService?.show?.({
          title: 'Error',
          message: 'Invalid parametric map display set.',
          type: 'error',
          duration: 3000,
        });
        return;
      }

      if (busyRef.current) {
        return;
      }

      setBusy(true);

      try {
        const state =
          viewportGridService.getState?.() || viewportGridService.getViewportGridState?.() || {};
        const viewports = getViewportsArray(state);

        const viewportId =
          activeViewportId ?? state?.activeViewportId ?? viewports[0]?.viewportId ?? null;

        if (!viewportId) {
          throw new Error('No active viewport is available.');
        }

        const isHangingLayout =
          typeof state?.isHangingProtocolLayout === 'boolean'
            ? state.isHangingProtocolLayout
            : true;

        const viewportEntry = getViewportEntryById(state, viewportId);
        const storedBaseUID = originalDisplaySetRef.current.get(viewportId);
        const baseUID =
          storedBaseUID ||
          safeSession.get(`${ORIGINAL_DS_UID_KEY}_${viewportId}`) ||
          viewportEntry?.displaySetInstanceUIDs?.[0] ||
          null;

        if (baseUID) {
          originalDisplaySetRef.current.set(viewportId, baseUID);
          safeSession.set(`${ORIGINAL_DS_UID_KEY}_${viewportId}`, baseUID);
        }

        const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
        if (!renderingEngine) {
          throw new Error('Rendering engine is not ready.');
        }

        const viewport = renderingEngine.getViewport(viewportId);
        if (!viewport) {
          throw new Error('Viewport is not available.');
        }

        const viewportState = captureViewportState(viewport);

        let updatedViewports =
          hangingProtocolService?.getViewportsRequireUpdate?.(
            viewportId,
            pmapDisplaySet.displaySetInstanceUID,
            isHangingLayout
          ) ?? [];

        if (!Array.isArray(updatedViewports) || !updatedViewports.length) {
          updatedViewports = [
            {
              viewportId,
              displaySetInstanceUIDs: [pmapDisplaySet.displaySetInstanceUID],
            },
          ];
        }

        updatedViewports = setInitialImageOverrides(updatedViewports, viewportState);

        const volumesReadyPromise = waitForViewportVolumes(cornerstoneViewportService, viewportId);

        safeSession.set(`${PMAP_STATE_KEY}_${viewportId}`, 'true');

        viewportGridService.setDisplaySetsForViewports(updatedViewports);
        await volumesReadyPromise;

        restoreViewportState(viewportId, viewportState);

        setSelectedWord(word.normalized);
      } catch (error) {
        console.error('Prompt words tab: failed to display parametric map', error);
        uiNotificationService?.show?.({
          title: 'Error',
          message: 'Could not display the explanation overlay.',
          type: 'error',
          duration: 3000,
        });
      } finally {
        setBusy(false);
      }
    },
    [
      activeViewportId,
      cornerstoneViewportService,
      hangingProtocolService,
      setBusy,
      uiNotificationService,
      viewportGridService,
    ]
  );

  const hidePmap = useCallback(async () => {
    if (!viewportGridService) {
      setSelectedWord(null);
      return;
    }

    if (busyRef.current) {
      return;
    }

    setBusy(true);

    try {
      const state =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.() || {};
      const viewports = getViewportsArray(state);

      const viewportId =
        activeViewportId ?? state?.activeViewportId ?? viewports[0]?.viewportId ?? null;

      if (!viewportId) {
        throw new Error('No active viewport is available.');
      }

      const isHangingLayout =
        typeof state?.isHangingProtocolLayout === 'boolean' ? state.isHangingProtocolLayout : true;

      const viewportEntry = getViewportEntryById(state, viewportId);

      const originalUID =
        originalDisplaySetRef.current.get(viewportId) ||
        safeSession.get(`${ORIGINAL_DS_UID_KEY}_${viewportId}`) ||
        viewportEntry?.displaySetInstanceUIDs?.[0] ||
        null;

      if (!originalUID) {
        safeSession.set(`${PMAP_STATE_KEY}_${viewportId}`, 'false');
        safeSession.remove(`${ORIGINAL_DS_UID_KEY}_${viewportId}`);
        originalDisplaySetRef.current.delete(viewportId);
        setSelectedWord(null);
        return;
      }

      const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
      if (!renderingEngine) {
        throw new Error('Rendering engine is not ready.');
      }

      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) {
        throw new Error('Viewport is not available.');
      }

      const viewportState = captureViewportState(viewport);

      let updatedViewports =
        hangingProtocolService?.getViewportsRequireUpdate?.(
          viewportId,
          originalUID,
          isHangingLayout
        ) ?? [];

      if (!Array.isArray(updatedViewports) || !updatedViewports.length) {
        updatedViewports = [
          {
            viewportId,
            displaySetInstanceUIDs: [originalUID],
          },
        ];
      }

      updatedViewports = setInitialImageOverrides(updatedViewports, viewportState);

      const volumesReadyPromise = waitForViewportVolumes(cornerstoneViewportService, viewportId);

      viewportGridService.setDisplaySetsForViewports(updatedViewports);
      await volumesReadyPromise;

      restoreViewportState(viewportId, viewportState);

      safeSession.set(`${PMAP_STATE_KEY}_${viewportId}`, 'false');
      safeSession.remove(`${ORIGINAL_DS_UID_KEY}_${viewportId}`);
      originalDisplaySetRef.current.delete(viewportId);
      setSelectedWord(null);
    } catch (error) {
      console.error('Prompt words tab: failed to hide parametric map', error);
      uiNotificationService?.show?.({
        title: 'Error',
        message: 'Could not hide the explanation overlay.',
        type: 'error',
        duration: 3000,
      });
    } finally {
      setBusy(false);
    }
  }, [
    activeViewportId,
    cornerstoneViewportService,
    hangingProtocolService,
    setBusy,
    uiNotificationService,
    viewportGridService,
  ]);

  const handleWordToggle = useCallback(
    async (word: WordEntry, shouldActivate: boolean) => {
      if (busyRef.current) {
        return;
      }

      if (shouldActivate) {
        const pmapDisplaySet = findPmapDisplaySetForWord(word);
        if (!pmapDisplaySet) {
          uiNotificationService?.show?.({
            title: 'Not Available',
            message: `No parametric map found with a series description matching "${word.original}".`,
            type: 'info',
            duration: 3000,
          });
          return;
        }

        await showPmapForDisplaySet(word, pmapDisplaySet);
      } else if (selectedWord === word.normalized) {
        await hidePmap();
      }
    },
    [
      findPmapDisplaySetForWord,
      hidePmap,
      selectedWord,
      showPmapForDisplaySet,
      uiNotificationService,
    ]
  );

  const activeWordLabel = useMemo(() => {
    if (!selectedWord) {
      return null;
    }
    return displayWords.find(entry => entry.normalized === selectedWord)?.original ?? selectedWord;
  }, [displayWords, selectedWord]);

  return (
    <div className="bg-primary-dark flex h-full min-h-0 flex-col p-4 text-white">
      <h3 className="text-base font-semibold">Prompt Keywords</h3>
      <p className="text-primary-light/70 text-xs">
        Toggle a term to see what region of the image the AI generated.
      </p>

      {isLoadingPrompt ? (
        <p className="text-primary-light/80 mt-4 text-sm">Loading prompt metadata…</p>
      ) : null}

      {!isLoadingPrompt && promptError ? (
        <p className="mt-4 text-sm text-red-300">{promptError}</p>
      ) : null}

      {!isLoadingPrompt && !promptWords.length && !promptError ? (
        <p className="text-primary-light/80 mt-4 text-sm">
          No prompt keywords available for the current series.
        </p>
      ) : null}

      <div className="ohif-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto">
        {displayWords.map(word => (
          <label
            key={word.normalized}
            className={`border-primary-light/40 mb-2 flex items-center justify-between rounded-md border bg-black/40 px-3 py-2 text-sm ${
              selectedWord === word.normalized ? 'border-primary-main bg-primary-main/20' : ''
            }`}
          >
            <span className="mr-4">{word.original}</span>
            <input
              type="checkbox"
              className="accent-primary-main h-4 w-4 cursor-pointer"
              checked={selectedWord === word.normalized}
              onChange={event => handleWordToggle(word, event.target.checked)}
              disabled={isBusy}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-primary-light/70 text-xs">
          {activeWordLabel ? `Showing overlay for “${activeWordLabel}”` : 'No overlay selected.'}
        </span>
        <button
          className="bg-primary-main ml-3 rounded px-3 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => hidePmap()}
          disabled={!selectedWord || isBusy}
        >
          Hide overlays
        </button>
      </div>
    </div>
  );
}

export default RadiopaediaComponent;
