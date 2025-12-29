import React, { useState, useEffect, useCallback } from 'react';
import classnames from 'classnames';
import { getRenderingEngine, metaData, StackViewport, VolumeViewport } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';
import './ViewportOverlay.css';
import { useImageViewer, useViewportGrid } from '@ohif/ui';

export type ViewportOverlayProps = {
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  color?: string;
  servicesManager: AppTypes.ServicesManager;
};

// Define a key to use for session storage
const PMAP_STATE_KEY = 'pmap_visibility_state';
// ADDED: A new key specifically for the original DisplaySet UID
const ORIGINAL_DS_UID_KEY = 'original_display_set_uid';

const ViewportOverlay = ({
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
  color = 'text-primary-light',
  servicesManager,
}: ViewportOverlayProps) => {
  const overlay = 'absolute pointer-events-none viewport-overlay';
  const [{ activeViewportId, viewports, isHangingProtocolLayout }, viewportGridService] =
    useViewportGrid();
  const {
    displaySetService,
    uiNotificationService,
    hangingProtocolService,
    cornerstoneViewportService,
  } = servicesManager.services;
  const [isCopying, setIsCopying] = useState(false);

  const waitForViewportVolumes = viewportId =>
    new Promise<void>(resolve => {
      const service = cornerstoneViewportService;
      if (!service) {
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

      const subscription = service.subscribe(
        service.EVENTS.VIEWPORT_VOLUMES_CHANGED,
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
    });

  const captureViewportState = viewport => {
    if (!viewport) {
      return null;
    }

    const currentIndex = viewport.getCurrentImageIdIndex?.();

    const state: {
      imageIndex?: number;
      voiRange?: { lower: number; upper: number };
      colormap?: Record<string, unknown>;
    } = {};

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

  const setInitialImageOverrides = (viewportsToUpdate, viewportState) => {
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

  const restoreViewportState = ({ viewportId, viewportState }) => {
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

    const applyProperties = properties => {
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

  // 1. Initialize state by reading from sessionStorage.
  // We check if the stored value for our active viewport is 'true'.
  const [isPmapVisible, setIsPmapVisible] = useState(() => {
    const storedState = sessionStorage.getItem(`${PMAP_STATE_KEY}_${activeViewportId}`);
    return storedState === 'true';
  });

  // 2. Use useEffect to update the button text if the state changes from elsewhere.
  useEffect(() => {
    const storedState = sessionStorage.getItem(`${PMAP_STATE_KEY}_${activeViewportId}`);
    setIsPmapVisible(storedState === 'true');
  }, [activeViewportId]); // Re-check when the active viewport changes

  const handleExplainClick = async () => {
    // The "event" parameter is no longer needed
    let updatedViewports = [];

    // REMOVED: No longer getting viewportId from the DOM event.
    // We will use `activeViewportId` from the hook for consistency.
    const viewportId = activeViewportId;

    const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
    const viewport = renderingEngine.getViewport(viewportId);
    const imageId = viewport.getCurrentImageId();
    const seriesInstanceUID = metaData.get('SeriesInstanceUID', imageId);
    const allDisplaySets = displaySetService.getActiveDisplaySets();

    const pmapDisplaySet = allDisplaySets.find(
      ds =>
        ds.referencedSeriesInstanceUID === seriesInstanceUID &&
        ds.SOPClassUID === '1.2.840.10008.5.1.4.1.1.30'
    );

    if (!isPmapVisible && !pmapDisplaySet) {
      console.warn('❌ No pMap display set found for this series!');
      return;
    }

    const viewportState = captureViewportState(viewport);

    try {
      if (isPmapVisible) {
        // --- LOGIC TO HIDE (REVERT TO ORIGINAL) ---
        let originalDisplaySetUID = sessionStorage.getItem(
          `${ORIGINAL_DS_UID_KEY}_${viewportId}`
        );

        if (!originalDisplaySetUID) {
          const fallbackDisplaySet =
            allDisplaySets?.find(ds => {
              const dsSeriesUID =
                ds?.SeriesInstanceUID ??
                ds?.seriesInstanceUID ??
                ds?.metadata?.SeriesInstanceUID;
              const sopUID = ds?.SOPClassUID || ds?.sopClassUID;
              return dsSeriesUID === seriesInstanceUID && sopUID !== '1.2.840.10008.5.1.4.1.1.30';
            }) ?? null;

          if (fallbackDisplaySet?.displaySetInstanceUID) {
            originalDisplaySetUID = fallbackDisplaySet.displaySetInstanceUID;
            sessionStorage.setItem(`${ORIGINAL_DS_UID_KEY}_${viewportId}`, originalDisplaySetUID);
          }
        }

        if (!originalDisplaySetUID) {
          uiNotificationService?.show?.({
            title: 'Unable to hide overlay',
            message: 'Original series could not be resolved.',
            type: 'warning',
            duration: 3000,
          });
          return;
        }

        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          activeViewportId,
          originalDisplaySetUID,
          isHangingProtocolLayout
        );
        updatedViewports = setInitialImageOverrides(updatedViewports, viewportState);

        sessionStorage.removeItem(`${ORIGINAL_DS_UID_KEY}_${viewportId}`);
        sessionStorage.setItem(`${PMAP_STATE_KEY}_${viewportId}`, 'false');
        setIsPmapVisible(false);
      } else {
        // --- LOGIC TO EXPLAIN (SHOW PMAP) ---
        console.log('--- Debugging "Explain" Click ---');

        // Let's inspect the variables we are using
        console.log('Active Viewport ID:', activeViewportId);
        console.log('Viewports object:', viewports);

        const activeViewportData = viewports.get(activeViewportId);
        console.log('Data for Active Viewport:', activeViewportData);

        const originalDisplaySetUID = activeViewportData?.displaySetInstanceUIDs?.[0];
        console.log('Found Original DisplaySet UID:', originalDisplaySetUID);

        if (originalDisplaySetUID) {
          console.log('✅ SAVING UID to session storage:', originalDisplaySetUID);
          sessionStorage.setItem(`${ORIGINAL_DS_UID_KEY}_${viewportId}`, originalDisplaySetUID);
        } else {
          // This is likely where the problem is.
          console.error('❌ FAILED to find original DisplaySet UID. Nothing will be saved.');
        }

        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          activeViewportId,
          pmapDisplaySet.displaySetInstanceUID,
          isHangingProtocolLayout
        );
        updatedViewports = setInitialImageOverrides(updatedViewports, viewportState);

        sessionStorage.setItem(`${PMAP_STATE_KEY}_${viewportId}`, 'true');
        setIsPmapVisible(true);
        console.log('--- End Debugging ---');
      }
    } catch (error) {
      console.warn(error);
      uiNotificationService.show({
        title: 'Error',
        message: 'Could not change the viewport.',
        type: 'error',
        duration: 3000,
      });
      sessionStorage.setItem(`${PMAP_STATE_KEY}_${viewportId}`, 'false');
      sessionStorage.removeItem(`${ORIGINAL_DS_UID_KEY}_${viewportId}`);
      return;
    }

    const volumesReadyPromise = waitForViewportVolumes(viewportId);
    viewportGridService.setDisplaySetsForViewports(updatedViewports);
    await volumesReadyPromise;

    restoreViewportState({
      viewportId,
      viewportState,
    });
  };

  const copyViewportToClipboard = useCallback(async () => {
    if (!cornerstoneViewportService) {
      uiNotificationService?.show?.({
        title: 'Capture failed',
        message: 'Viewport service is unavailable.',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    const viewportId = activeViewportId ?? cornerstoneViewportService.getActiveViewportId?.();

    if (!viewportId) {
      uiNotificationService?.show?.({
        title: 'Capture failed',
        message: 'No active viewport selected.',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport) {
      uiNotificationService?.show?.({
        title: 'Capture failed',
        message: 'Viewport is not ready yet. Try again in a moment.',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    viewport.render?.();

    const canvas = viewport.getCanvas?.();

    if (!(canvas instanceof HTMLCanvasElement)) {
      uiNotificationService?.show?.({
        title: 'Capture failed',
        message: 'Unable to access viewport canvas.',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    try {
      setIsCopying(true);
      const dataUrl = canvas.toDataURL('image/png');

      const ensureBlob = async () =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            result => {
              if (result) {
                resolve(result);
              } else {
                reject(new Error('Unable to capture viewport image.'));
              }
            },
            'image/png',
            1
          );
        });

      const tryWriteImage = async () => {
        const permission =
          navigator.permissions && 'query' in navigator.permissions
            ? await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })
            : null;

        if (permission && permission.state === 'denied') {
          throw new Error('Clipboard permission denied for images.');
        }

        const blob = await ensureBlob();
        const clipboardItem = new ClipboardItem({ [blob.type]: blob });
        await navigator.clipboard.write([clipboardItem]);
        return 'image';
      };

      const tryWriteText = async () => {
        await navigator.clipboard.writeText(dataUrl);
        return 'data-url';
      };

      // Fallback that uses execCommand to copy an <img> node.
      // This works on some insecure origins where the async clipboard API is blocked.
      const tryLegacyImageCopy = async () => {
        const wrapper = document.createElement('div');
        wrapper.contentEditable = 'true';
        wrapper.style.position = 'fixed';
        wrapper.style.opacity = '0';
        const img = document.createElement('img');
        img.src = dataUrl;
        wrapper.appendChild(img);
        document.body.appendChild(wrapper);

        const range = document.createRange();
        range.selectNodeContents(wrapper);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const ok = document.execCommand('copy');

        selection?.removeAllRanges();
        document.body.removeChild(wrapper);

        if (!ok) {
          throw new Error('Legacy image copy was blocked.');
        }

        return 'image';
      };

      const tryLegacyCopy = async () => {
        const textarea = document.createElement('textarea');
        textarea.value = dataUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) {
          throw new Error('Legacy copy command was blocked.');
        }
        return 'data-url';
      };

      let outcome: 'image' | 'data-url' | null = null;
      let firstError: any = null;

      if (navigator.clipboard?.write) {
        try {
          outcome = await tryWriteImage();
        } catch (err) {
          firstError = err;
        }
      }

      if (!outcome) {
        try {
          outcome = await tryLegacyImageCopy();
        } catch (err) {
          firstError = firstError || err;
        }
      }

      if (!outcome) {
        try {
          outcome = await tryWriteText();
        } catch (err) {
          firstError = firstError || err;
        }
      }

      if (!outcome) {
        try {
          outcome = await tryLegacyCopy();
        } catch (err) {
          firstError = firstError || err;
        }
      }

      if (!outcome) {
        throw firstError || new Error('Clipboard request was blocked.');
      }

      uiNotificationService?.show?.({
        title: 'Captured',
        message:
          outcome === 'image'
            ? 'Viewport image copied to clipboard.'
            : 'Viewport copied as Data URL (image copy blocked).',
        type: outcome === 'image' ? 'success' : 'warning',
        duration: outcome === 'image' ? 2000 : 3500,
      });
    } catch (error: any) {
      console.warn('ViewportOverlay: failed to copy viewport', error);
      uiNotificationService?.show?.({
        title: 'Capture failed',
        message:
          error?.message ||
          'Clipboard request was blocked. Use HTTPS/localhost or tap Clipboard help for setup steps.',
        type: 'error',
        duration: 3500,
      });
    } finally {
      setIsCopying(false);
    }
  }, [activeViewportId, cornerstoneViewportService, uiNotificationService]);

  return (
    <div
      className={classnames(
        color ? color : 'text-aqua-pale',
        'text-[13px]',
        'leading-5',
        'overlay-text'
      )}
    >
      <div
        data-cy={'viewport-overlay-top-left'}
        className={classnames(overlay, 'overlay-top left-viewport')}
      >
        {topLeft}
      </div>
      <div
        data-cy={'viewport-overlay-top-right'}
        className={classnames(overlay, 'overlay-top right-viewport-scrollbar')}
      >
        {topRight}

        <button
          data-cy="viewport-capture"
          className="pointer-events-auto ml-2 rounded-md bg-black/60 px-3 py-1 text-xs font-semibold text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={copyViewportToClipboard}
          disabled={isCopying}
        >
          {isCopying ? 'Capturing…' : 'Capture'}
        </button>

        {/* 🔹 Updated Explain Button */}
        {/* <button
          style={{
            padding: '5px 10px',
            backgroundColor: '#00bcd4',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            borderRadius: '5px',
            pointerEvents: 'all',
          }}
          onClick={handleExplainClick}
        >
          {isPmapVisible ? 'Hide' : 'Explain'}
        </button> */}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-right'}
        className={classnames(overlay, 'overlay-bottom right-viewport-scrollbar')}
      >
        {bottomRight}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-left'}
        className={classnames(overlay, 'overlay-bottom left-viewport')}
      >
        {bottomLeft}
      </div>
    </div>
  );
};

export default ViewportOverlay;
