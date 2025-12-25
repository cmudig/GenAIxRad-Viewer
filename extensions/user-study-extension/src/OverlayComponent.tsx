import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';
import { getRenderingEngine, StackViewport, VolumeViewport } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';

const PMAP_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.30';
const PMAP_STATE_KEY = 'pmap_visibility_state';
const ORIGINAL_DS_UID_KEY = 'original_display_set_uid';
const SELECTED_PMAP_UID_KEY = 'selected_pmap_uid';
const ENTIRE_PROMPT_PATTERN = /\b(CLS|SINGLE)\b/i;

type OverlayComponentProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type ViewportEntry = {
  viewportId: string;
  displaySetInstanceUIDs?: string[];
  [key: string]: any;
} | null;

type PmapEntry = {
  displaySetInstanceUID: string;
  seriesDescription: string;
  label: string;
  isEntirePrompt: boolean;
};

type ViewportState = {
  imageIndex?: number;
  voiRange?: { lower: number; upper: number };
  colormap?: Record<string, unknown>;
};

const getViewportEntry = (viewports: any, viewportId: string | null): ViewportEntry => {
  if (!viewports || !viewportId) {
    return null;
  }

  if (typeof viewports.get === 'function') {
    return viewports.get(viewportId) ?? null;
  }

  if (Array.isArray(viewports)) {
    return viewports.find(item => item?.viewportId === viewportId) ?? null;
  }

  if (typeof viewports === 'object') {
    return viewports[viewportId] ?? null;
  }

  return null;
};

const safeString = (value: any): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  return String(value);
};

const getSeriesDescription = (displaySet: any): string => {
  if (!displaySet) {
    return '';
  }

  return (
    safeString(displaySet.SeriesDescription) ||
    safeString(displaySet.seriesDescription) ||
    safeString(displaySet.metadata?.SeriesDescription) ||
    safeString(displaySet.getAttribute?.('SeriesDescription'))
  );
};

const textOrNull = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const getSeriesInstanceUID = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }

  return (
    safeString(displaySet.SeriesInstanceUID) ||
    safeString(displaySet.seriesInstanceUID) ||
    safeString(displaySet.metadata?.SeriesInstanceUID) ||
    safeString(displaySet.getAttribute?.('SeriesInstanceUID')) ||
    null
  );
};

const getReferencedSeriesInstanceUID = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }

  return (
    safeString(displaySet.referencedSeriesInstanceUID) ||
    safeString(displaySet.ReferencedSeriesInstanceUID) ||
    safeString(displaySet.metadata?.ReferencedSeriesInstanceUID) ||
    safeString(displaySet.getAttribute?.('ReferencedSeriesInstanceUID')) ||
    null
  );
};

const getSOPClassUID = (displaySet: any): string => {
  if (!displaySet) {
    return '';
  }

  return (
    safeString(displaySet.SOPClassUID) ||
    safeString(displaySet.sopClassUID) ||
    safeString(displaySet.metadata?.SOPClassUID) ||
    safeString(displaySet.getAttribute?.('SOPClassUID'))
  );
};

const isPmapDisplaySet = (displaySet: any): boolean =>
  getSOPClassUID(displaySet) === PMAP_SOP_CLASS_UID;

const derivePmapLabel = (description: string, fallback: string): string => {
  if (!description) {
    return fallback;
  }

  const sanitized = description
    .replace(/\b(PMAP|Probability Map|Saliency Map|Map|Highlight)\b/gi, '')
    .replace(/\b(CLS|SINGLE)\b/gi, '')
    .replace(/[_]+/g, ' ')
    .trim();

  const quotedMatch = sanitized.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  const parentheticalMatch = sanitized.match(/\(([^()]+)\)/);
  if (parentheticalMatch) {
    return parentheticalMatch[1];
  }

  const colonParts = sanitized
    .split(':')
    .map(part => part.trim())
    .filter(Boolean);
  if (colonParts.length > 1) {
    return colonParts[colonParts.length - 1];
  }

  const hyphenParts = sanitized
    .split(/[-\u2013\u2014]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (hyphenParts.length > 1) {
    return hyphenParts[hyphenParts.length - 1];
  }

  if (sanitized.includes(' ')) {
    const tokens = sanitized.split(/\s+/).filter(Boolean);
    if (tokens.length) {
      return tokens[tokens.length - 1];
    }
  }

  return sanitized || fallback;
};

const buildPmapEntry = (displaySet: any): PmapEntry | null => {
  if (!displaySet || !displaySet.displaySetInstanceUID) {
    return null;
  }

  const seriesDescription = getSeriesDescription(displaySet);
  const isEntirePrompt = ENTIRE_PROMPT_PATTERN.test(seriesDescription);
  const label = isEntirePrompt
    ? `Entire Prompt${seriesDescription ? ` (${seriesDescription})` : ''}`
    : derivePmapLabel(seriesDescription, seriesDescription || 'Word Overlay');

  return {
    displaySetInstanceUID: displaySet.displaySetInstanceUID,
    seriesDescription,
    label,
    isEntirePrompt,
  };
};

const captureViewportState = (viewport: any): ViewportState | null => {
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
    if (properties?.voiRange) {
      state.voiRange = properties.voiRange;
    }
    if (properties?.colormap) {
      state.colormap = properties.colormap;
    }
  } else if (viewport instanceof VolumeViewport) {
    const volumeId = viewport.getVolumeId?.();
    if (volumeId) {
      const properties = viewport.getProperties?.(volumeId);
      if (properties?.voiRange) {
        state.voiRange = properties.voiRange;
      }
      if (properties?.colormap) {
        state.colormap = properties.colormap;
      }
    }
  } else {
    const properties = viewport.getProperties?.();
    if (properties?.voiRange) {
      state.voiRange = properties.voiRange;
    }
    if (properties?.colormap) {
      state.colormap = properties.colormap;
    }
  }

  return state;
};

const setInitialImageOverrides = (
  viewportsToUpdate: any[],
  viewportState: ViewportState | null
) => {
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

const restoreViewportState = ({
  viewportId,
  viewportState,
}: {
  viewportId: string;
  viewportState: ViewportState | null;
}) => {
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

const OverlayComponent: React.FC<OverlayComponentProps> = ({ servicesManager }) => {
  const [{ activeViewportId, viewports, isHangingProtocolLayout }, viewportGridService] =
    useViewportGrid();
  const [displaySetVersion, setDisplaySetVersion] = useState(0);
  const [selectedPmapUID, setSelectedPmapUID] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const {
    displaySetService,
    hangingProtocolService,
    uiNotificationService,
    cornerstoneViewportService,
  } = servicesManager?.services ?? {};

  useEffect(() => {
    if (!displaySetService?.subscribe) {
      return;
    }

    const events = [
      displaySetService.EVENTS?.DISPLAY_SETS_ADDED,
      displaySetService.EVENTS?.DISPLAY_SETS_CHANGED,
      displaySetService.EVENTS?.DISPLAY_SETS_REMOVED,
      displaySetService.EVENTS?.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
    ].filter(Boolean);

    const subscriptions = events.map(event =>
      displaySetService.subscribe(event, () => {
        setDisplaySetVersion(prev => prev + 1);
      })
    );

    return () => {
      subscriptions.forEach(sub => sub?.unsubscribe?.());
    };
  }, [displaySetService]);

  useEffect(() => {
    if (!activeViewportId || !displaySetService) {
      setSelectedPmapUID(null);
      return;
    }

    const hasSessionStorage = typeof window !== 'undefined' && !!window.sessionStorage;

    const viewportEntry = getViewportEntry(viewports, activeViewportId);
    const currentDisplaySetUID = viewportEntry?.displaySetInstanceUIDs?.[0] ?? null;
    if (!currentDisplaySetUID) {
      setSelectedPmapUID(null);
      return;
    }

    let detectedSelectedUID: string | null = null;
    try {
      const displaySet = displaySetService.getDisplaySetByUID(currentDisplaySetUID);
      if (displaySet && isPmapDisplaySet(displaySet)) {
        detectedSelectedUID = currentDisplaySetUID;
        if (hasSessionStorage) {
          sessionStorage.setItem(
            `${SELECTED_PMAP_UID_KEY}_${activeViewportId}`,
            currentDisplaySetUID
          );
        }
      } else {
        detectedSelectedUID = hasSessionStorage
          ? (sessionStorage.getItem(`${SELECTED_PMAP_UID_KEY}_${activeViewportId}`) ?? null)
          : null;
      }
    } catch (error) {
      console.warn('OverlayComponent: failed to resolve current viewport display set', error);
    }

    setSelectedPmapUID(prev => (prev === detectedSelectedUID ? prev : detectedSelectedUID));
  }, [activeViewportId, displaySetService, displaySetVersion, viewports]);

  const waitForViewportVolumes = useCallback(
    (viewportId: string) =>
      new Promise<void>(resolve => {
        if (!cornerstoneViewportService) {
          resolve();
          return;
        }

        let resolved = false;
        let timeoutId: number;
        let unsubscribe: (() => void) | undefined;

        const cleanup = () => {
          if (resolved) {
            return;
          }
          resolved = true;
          window.clearTimeout(timeoutId);
          unsubscribe?.();
          resolve();
        };

        timeoutId = window.setTimeout(cleanup, 750);

        const subscription = cornerstoneViewportService.subscribe(
          cornerstoneViewportService.EVENTS.VIEWPORT_VOLUMES_CHANGED,
          ({ viewportInfo }) => {
            if (viewportInfo.viewportId === viewportId) {
              cleanup();
            }
          }
        );

        unsubscribe = subscription?.unsubscribe;

        if (!subscription) {
          cleanup();
        }
      }),
    [cornerstoneViewportService]
  );

  const resolveDisplaySet = useCallback(
    (uid: string | null) => {
      if (!uid || !displaySetService?.getDisplaySetByUID) {
        return null;
      }
      try {
        return displaySetService.getDisplaySetByUID(uid);
      } catch (error) {
        console.warn('OverlayComponent: failed to resolve display set', error);
        return null;
      }
    },
    [displaySetService]
  );

  const baseInfo = useMemo(() => {
    if (!activeViewportId) {
      return { baseDisplaySet: null, targetSeriesInstanceUID: null, basePrompt: null };
    }

    const viewportEntry = getViewportEntry(viewports, activeViewportId);
    const candidateUID = viewportEntry?.displaySetInstanceUIDs?.[0] ?? null;

    const resolveSeriesUID = (ds: any): string | null =>
      ds
        ? (ds.SeriesInstanceUID ?? ds.seriesInstanceUID ?? ds.metadata?.SeriesInstanceUID ?? null)
        : null;

    let baseDisplaySet = resolveDisplaySet(candidateUID);

    if (baseDisplaySet && isPmapDisplaySet(baseDisplaySet)) {
      baseDisplaySet = null;
    }

    if (!baseDisplaySet) {
      const storedUID =
        (typeof window !== 'undefined'
          ? sessionStorage.getItem(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`)
          : null) ?? null;
      if (storedUID) {
        const storedSet = resolveDisplaySet(storedUID);
        if (storedSet && !isPmapDisplaySet(storedSet)) {
          baseDisplaySet = storedSet;
        }
      }
    }

    let targetSeriesInstanceUID = resolveSeriesUID(baseDisplaySet);

    if (!baseDisplaySet && candidateUID) {
      const candidate = resolveDisplaySet(candidateUID);
      if (candidate && isPmapDisplaySet(candidate)) {
        targetSeriesInstanceUID = getReferencedSeriesInstanceUID(candidate);
        if (targetSeriesInstanceUID) {
          const displaySetCache = displaySetService?.getDisplaySetCache?.();
          const allDisplaySets: any[] = displaySetCache
            ? Array.from(displaySetCache.values())
            : (displaySetService?.getActiveDisplaySets?.() ?? []);
          baseDisplaySet =
            allDisplaySets.find(ds => {
              if (isPmapDisplaySet(ds)) {
                return false;
              }
              const uid =
                ds.SeriesInstanceUID ??
                ds.seriesInstanceUID ??
                ds.metadata?.SeriesInstanceUID ??
                null;
              return uid === targetSeriesInstanceUID;
            }) ?? null;
        }
      }
    }

    if (!targetSeriesInstanceUID && baseDisplaySet) {
      targetSeriesInstanceUID = resolveSeriesUID(baseDisplaySet);
    }

    const basePrompt =
      safeString(
        baseDisplaySet?.SeriesPrompt ??
          baseDisplaySet?.seriesPrompt ??
          baseDisplaySet?.metadata?.SeriesPrompt ??
          baseDisplaySet?.getAttribute?.('SeriesPrompt')
      ) || null;

    const baseSeriesDescription =
      textOrNull(
        baseDisplaySet?.SeriesDescription,
        baseDisplaySet?.seriesDescription,
        baseDisplaySet?.metadata?.SeriesDescription
      ) || null;

    return { baseDisplaySet, targetSeriesInstanceUID, basePrompt, baseSeriesDescription };
  }, [activeViewportId, displaySetService, viewports, displaySetVersion, resolveDisplaySet]);

  const availablePmaps: PmapEntry[] = useMemo(() => {
    if (!displaySetService || !activeViewportId) {
      return [];
    }

    let { targetSeriesInstanceUID } = baseInfo;

    if (!targetSeriesInstanceUID && selectedPmapUID) {
      const selectedDisplaySet = resolveDisplaySet(selectedPmapUID);
      if (selectedDisplaySet && isPmapDisplaySet(selectedDisplaySet)) {
        targetSeriesInstanceUID = getReferencedSeriesInstanceUID(selectedDisplaySet);
      }
    }

    if (!targetSeriesInstanceUID) {
      return [];
    }

    const displaySetCache = displaySetService.getDisplaySetCache?.();
    const allDisplaySets: any[] = displaySetCache
      ? Array.from(displaySetCache.values())
      : (displaySetService.getActiveDisplaySets?.() ?? []);

    const entryMap = new Map<string, PmapEntry>();

    allDisplaySets.forEach(displaySet => {
      if (!isPmapDisplaySet(displaySet)) {
        return;
      }
      const referencedUID = getReferencedSeriesInstanceUID(displaySet);
      if (referencedUID !== targetSeriesInstanceUID) {
        return;
      }
      const entry = buildPmapEntry(displaySet);
      if (entry) {
        entryMap.set(entry.displaySetInstanceUID, entry);
      }
    });

    if (!entryMap.size && selectedPmapUID) {
      const selectedDisplaySet = resolveDisplaySet(selectedPmapUID);
      if (selectedDisplaySet && isPmapDisplaySet(selectedDisplaySet)) {
        const entry = buildPmapEntry(selectedDisplaySet);
        if (entry) {
          entryMap.set(entry.displaySetInstanceUID, entry);
        }
      }
    }

    const entries = Array.from(entryMap.values());

    entries.sort((a, b) => {
      if (a.isEntirePrompt && !b.isEntirePrompt) {
        return -1;
      }
      if (!a.isEntirePrompt && b.isEntirePrompt) {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });

    return entries;
  }, [activeViewportId, baseInfo, displaySetService, resolveDisplaySet, selectedPmapUID]);

  const applyDisplaySetToViewport = useCallback(
    async (
      viewportId: string,
      targetDisplaySetUID: string,
      viewportState: ViewportState | null
    ) => {
      if (!viewportGridService || !hangingProtocolService) {
        return;
      }

      let updates: any[] = [];
      try {
        updates =
          hangingProtocolService.getViewportsRequireUpdate?.(
            viewportId,
            targetDisplaySetUID,
            isHangingProtocolLayout
          ) ?? [];
      } catch (error) {
        console.warn('OverlayComponent: hanging protocol update failed', error);
      }

      if (!updates.length) {
        updates = [
          {
            viewportId,
            displaySetInstanceUIDs: [targetDisplaySetUID],
          },
        ];
      }

      updates = setInitialImageOverrides(updates, viewportState);

      const volumesReadyPromise = waitForViewportVolumes(viewportId);
      viewportGridService.setDisplaySetsForViewports(updates);
      await volumesReadyPromise;

      restoreViewportState({
        viewportId,
        viewportState,
      });
    },
    [hangingProtocolService, isHangingProtocolLayout, viewportGridService, waitForViewportVolumes]
  );

  const ensureOriginalDisplaySetStored = useCallback((): string | null => {
    if (!activeViewportId || !displaySetService) {
      return null;
    }

    const storedOriginal =
      sessionStorage.getItem(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`) ?? null;
    if (storedOriginal) {
      return storedOriginal;
    }

    const viewportEntry = getViewportEntry(viewports, activeViewportId);
    const currentDisplaySetUID = viewportEntry?.displaySetInstanceUIDs?.[0] ?? null;
    if (!currentDisplaySetUID) {
      return null;
    }

    try {
      const currentDisplaySet = displaySetService.getDisplaySetByUID(currentDisplaySetUID);
      if (currentDisplaySet && !isPmapDisplaySet(currentDisplaySet)) {
        sessionStorage.setItem(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`, currentDisplaySetUID);
        return currentDisplaySetUID;
      }
    } catch (error) {
      console.warn('OverlayComponent: failed to capture original display set', error);
    }

    return null;
  }, [activeViewportId, displaySetService, viewports]);

  const handleToggle = useCallback(
    async (targetDisplaySetUID: string) => {
      if (!activeViewportId || !displaySetService) {
        return;
      }

      if (isBusy) {
        return;
      }

      setIsBusy(true);

      try {
        const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
        const viewport = renderingEngine?.getViewport(activeViewportId);
        if (!viewport) {
          throw new Error('Unable to resolve active viewport for overlay toggle.');
        }

        const viewportState = captureViewportState(viewport);

        if (selectedPmapUID === targetDisplaySetUID) {
          const originalUID =
            sessionStorage.getItem(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`) ?? null;
          if (!originalUID) {
            uiNotificationService?.show?.({
              title: 'Unable to restore',
              message: 'Original viewport state was not recorded.',
              type: 'warning',
              duration: 3000,
            });
            return;
          }

          await applyDisplaySetToViewport(activeViewportId, originalUID, viewportState);
          sessionStorage.setItem(`${PMAP_STATE_KEY}_${activeViewportId}`, 'false');
          sessionStorage.removeItem(`${SELECTED_PMAP_UID_KEY}_${activeViewportId}`);
          setSelectedPmapUID(null);
        } else {
          const originalUID = ensureOriginalDisplaySetStored();
          if (!originalUID) {
            uiNotificationService?.show?.({
              title: 'Overlay unavailable',
              message: 'No base series found for the active viewport.',
              type: 'info',
              duration: 3000,
            });
            return;
          }

          await applyDisplaySetToViewport(activeViewportId, targetDisplaySetUID, viewportState);
          sessionStorage.setItem(`${PMAP_STATE_KEY}_${activeViewportId}`, 'true');
          sessionStorage.setItem(
            `${SELECTED_PMAP_UID_KEY}_${activeViewportId}`,
            targetDisplaySetUID
          );
          setSelectedPmapUID(targetDisplaySetUID);
        }
      } catch (error) {
        console.error('OverlayComponent: failed to toggle PMAP overlay', error);
        uiNotificationService?.show?.({
          title: 'Error',
          message: 'Unable to update the viewport with the requested overlay.',
          type: 'error',
          duration: 3000,
        });
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeViewportId,
      applyDisplaySetToViewport,
      ensureOriginalDisplaySetStored,
      displaySetService,
      isBusy,
      selectedPmapUID,
      uiNotificationService,
    ]
  );

  const entirePromptEntries = useMemo(
    () => availablePmaps.filter(item => item.isEntirePrompt),
    [availablePmaps]
  );
  const wordEntries = useMemo(
    () => availablePmaps.filter(item => !item.isEntirePrompt),
    [availablePmaps]
  );

  const renderCard = (entry: PmapEntry) => {
    const isSelected = selectedPmapUID === entry.displaySetInstanceUID;
    const entirePromptText =
      baseInfo.baseSeriesDescription ||
      baseInfo.basePrompt ||
      entry.seriesDescription ||
      'Prompt used to generate CT scan';
    const title = entry.isEntirePrompt ? entirePromptText : entry.label;
    const note = entry.isEntirePrompt
      ? '(Prompt used to generate CT scan)'
      : entry.seriesDescription || '';

    return (
      <button
        key={entry.displaySetInstanceUID}
        onClick={() => handleToggle(entry.displaySetInstanceUID)}
        disabled={isBusy}
        className={`w-full rounded-2xl border px-4 py-3 text-left shadow-lg shadow-black/40 transition ${
          isSelected
            ? 'border-aqua-pale bg-[#13234d]'
            : 'border-transparent bg-[#0b1433] hover:border-white/20'
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-sm">{title}</p>
            {note && (
              <p className="text-primary-light mt-1 text-xs italic">
                {entry.isEntirePrompt && isSelected ? 'Tap to hide overlay' : note}
              </p>
            )}
          </div>
          <span className="text-lg text-white/60">{isSelected ? '×' : '›'}</span>
        </div>
      </button>
    );
  };

  const isPatientScan = useMemo(() => {
    const displaySet = baseInfo.baseDisplaySet;
    if (!displaySet) {
      return true;
    }
    const origin = (displaySet as any).__caseOrigin;
    if (origin === 'ai') {
      return false;
    }
    const promptChanged =
      displaySet.SeriesPromptChanged ??
      displaySet.seriesPromptChanged ??
      displaySet.metadata?.SeriesPromptChanged ??
      displaySet.getAttribute?.('SeriesPromptChanged') ??
      null;
    return String(promptChanged).toLowerCase() !== 'true';
  }, [baseInfo]);

  if (!displaySetService || !viewportGridService) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col p-4 text-sm text-white">
        <div className="border-primary-dark rounded-md border bg-black p-3">
          Important region overlays require display set services, which are not available.
        </div>
      </div>
    );
  }

  if (!activeViewportId) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col p-4 text-sm text-white">
        <div className="border-primary-dark rounded-md border bg-black p-3">
          Select a viewport to access important region overlays.
        </div>
      </div>
    );
  }

  if (!availablePmaps.length) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col gap-3 p-4 text-sm text-white">
        <div className="border-primary-dark rounded-md border bg-black p-3">
          No overlays were detected for the active series.
        </div>
        {selectedPmapUID ? (
          <button
            className="border-primary-dark hover:border-primary-light hover:bg-primary-dark rounded-md border bg-black px-3 py-2 text-sm text-white"
            disabled={isBusy}
            onClick={() => handleToggle(selectedPmapUID)}
          >
            Hide current overlay
          </button>
        ) : null}
      </div>
    );
  }

  if (isPatientScan) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col p-4 text-white">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/80">
          You first need to generate a CT scan from the Variations or Similar Cases tab before
          viewing important regions.
        </div>
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col gap-4 p-4 text-white">
      <div>
        <p className="text-base font-semibold">Important Regions</p>
        <p className="text-sm text-white/70">
          Highlight image regions most influenced by the prompt to see how the AI generated the CT
          scan.
        </p>
      </div>

      <div className="space-y-3">
        {entirePromptEntries.map(entry => renderCard(entry))}
        {wordEntries.length
          ? wordEntries.map(entry => renderCard(entry))
          : !entirePromptEntries.length && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-white/70">
                No keyword overlays are available for this series.
              </div>
            )}
      </div>
    </div>
  );
};

export default OverlayComponent;
