import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';
import { getRenderingEngine, StackViewport, VolumeViewport } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';

const PMAP_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.30';
const PMAP_STATE_KEY = 'pmap_visibility_state';
const ORIGINAL_DS_UID_KEY = 'original_display_set_uid';
const SELECTED_PMAP_UID_KEY = 'selected_pmap_uid';
const ENTIRE_PROMPT_PATTERN = /\b(CLS|SINGLE)\b/i;

type RadiopaediaComponentProps = {
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

  const colonParts = sanitized.split(':').map(part => part.trim()).filter(Boolean);
  if (colonParts.length > 1) {
    return colonParts[colonParts.length - 1];
  }

  const hyphenParts = sanitized.split(/[-\u2013\u2014]/).map(part => part.trim()).filter(Boolean);
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

const setInitialImageOverrides = (viewportsToUpdate: any[], viewportState: ViewportState | null) => {
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

const RadiopaediaComponent: React.FC<RadiopaediaComponentProps> = ({ servicesManager }) => {
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
          ? sessionStorage.getItem(`${SELECTED_PMAP_UID_KEY}_${activeViewportId}`) ?? null
          : null;
      }
    } catch (error) {
      console.warn('RadiopaediaComponent: failed to resolve current viewport display set', error);
    }

    setSelectedPmapUID(prev =>
      prev === detectedSelectedUID ? prev : detectedSelectedUID
    );
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

  const availablePmaps: PmapEntry[] = useMemo(() => {
    if (!displaySetService || !activeViewportId) {
      return [];
    }

    const resolveDisplaySet = (uid: string | null) => {
      if (!uid) {
        return null;
      }
      try {
        return displaySetService.getDisplaySetByUID(uid);
      } catch (error) {
        console.warn('RadiopaediaComponent: failed to resolve display set', error);
        return null;
      }
    };

    const viewportEntry = getViewportEntry(viewports, activeViewportId);
    const candidateDisplaySetUID = viewportEntry?.displaySetInstanceUIDs?.[0] ?? null;

    let baseDisplaySetUID: string | null = null;
    let baseDisplaySet: any = null;

    const candidateDisplaySet = resolveDisplaySet(candidateDisplaySetUID);
    if (candidateDisplaySet && !isPmapDisplaySet(candidateDisplaySet)) {
      baseDisplaySetUID = candidateDisplaySetUID;
      baseDisplaySet = candidateDisplaySet;
    }

    if (!baseDisplaySetUID) {
      const storedOriginal =
        (typeof window !== 'undefined' && window.sessionStorage
          ? sessionStorage.getItem(`${ORIGINAL_DS_UID_KEY}_${activeViewportId}`)
          : null) ?? null;
      if (storedOriginal) {
        baseDisplaySetUID = storedOriginal;
        baseDisplaySet = resolveDisplaySet(storedOriginal);
      }
    }

    let targetSeriesInstanceUID: string | null = null;
    if (baseDisplaySet) {
      targetSeriesInstanceUID = getSeriesInstanceUID(baseDisplaySet);
    }

    if (!targetSeriesInstanceUID && candidateDisplaySet && isPmapDisplaySet(candidateDisplaySet)) {
      targetSeriesInstanceUID = getReferencedSeriesInstanceUID(candidateDisplaySet);
    }

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
      : displaySetService.getActiveDisplaySets?.() ?? [];

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
  }, [activeViewportId, displaySetService, displaySetVersion, selectedPmapUID, viewports]);

  const applyDisplaySetToViewport = useCallback(
    async (viewportId: string, targetDisplaySetUID: string, viewportState: ViewportState | null) => {
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
        console.warn('RadiopaediaComponent: hanging protocol update failed', error);
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
      console.warn('RadiopaediaComponent: failed to capture original display set', error);
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
        console.error('RadiopaediaComponent: failed to toggle PMAP overlay', error);
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

  const renderToggleButton = (entry: PmapEntry) => {
    const isSelected = selectedPmapUID === entry.displaySetInstanceUID;
    const baseClasses =
      'w-full rounded-md border px-3 py-2 text-left text-sm transition focus:outline-none';
    const selectedClasses =
      'border-aqua-pale bg-aqua-pale/20 text-white shadow-sm hover:bg-aqua-pale/30';
    const defaultClasses =
      'border-primary-dark bg-black text-white hover:border-primary-light hover:bg-primary-dark';

    return (
      <button
        key={entry.displaySetInstanceUID}
        className={`${baseClasses} ${isSelected ? selectedClasses : defaultClasses}`}
        disabled={isBusy}
        onClick={() => handleToggle(entry.displaySetInstanceUID)}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {entry.isEntirePrompt
              ? isSelected
                ? 'Hide Entire Prompt'
                : 'Show Entire Prompt'
              : entry.label}
          </span>
          {isBusy && isSelected && (
            <span className="text-xs uppercase text-primary-light">Updating...</span>
          )}
        </div>
        {!entry.isEntirePrompt && entry.seriesDescription && (
          <div className="text-primary-light mt-1 text-xs">{entry.seriesDescription}</div>
        )}
      </button>
    );
  };

  if (!displaySetService || !viewportGridService) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col p-4 text-sm text-white">
        <div className="rounded-md border border-primary-dark bg-black p-3">
          Radiopaedia overlays require display set services, which are not available.
        </div>
      </div>
    );
  }

  if (!activeViewportId) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col p-4 text-sm text-white">
        <div className="rounded-md border border-primary-dark bg-black p-3">
          Select a viewport to access Radiopaedia overlays.
        </div>
      </div>
    );
  }

  if (!availablePmaps.length) {
    return (
      <div className="ohif-scrollbar flex h-full flex-col gap-3 p-4 text-sm text-white">
        <div className="rounded-md border border-primary-dark bg-black p-3">
          No Radiopaedia overlays were detected for the active series.
        </div>
        {selectedPmapUID ? (
          <button
            className="border-primary-dark bg-black text-white hover:border-primary-light hover:bg-primary-dark rounded-md border px-3 py-2 text-sm"
            disabled={isBusy}
            onClick={() => handleToggle(selectedPmapUID)}
          >
            Hide current overlay
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col p-4 text-white">
      <div className="flex-0 mb-4">
        <h3 className="text-lg font-semibold leading-tight">Radiopaedia Overlays</h3>
        <p className="text-primary-light mt-1 text-xs">
          Toggle AI-generated probability maps to explore the prompt and individual keywords.
        </p>
      </div>

      {entirePromptEntries.length > 0 && (
        <div className="mb-4 rounded-md border border-primary-dark bg-black p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-aqua-pale">
            Entire Prompt
          </div>
          <div className="space-y-2">
            {entirePromptEntries.map(entry => renderToggleButton(entry))}
          </div>
        </div>
      )}

      <div className="rounded-md border border-primary-dark bg-black p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-aqua-pale">
          Prompt Keywords
        </div>
        {wordEntries.length ? (
          <div className="grid grid-cols-1 gap-2">
            {wordEntries.map(entry => renderToggleButton(entry))}
          </div>
        ) : (
          <div className="text-primary-light text-xs">
            No keyword-level overlays detected for this series.
          </div>
        )}
      </div>
    </div>
  );
};

export default RadiopaediaComponent;
