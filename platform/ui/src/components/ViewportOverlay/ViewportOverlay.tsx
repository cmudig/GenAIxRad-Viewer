import React, { useState, useEffect } from 'react';
import classnames from 'classnames';
import { getRenderingEngine, metaData, StackViewport } from '@cornerstonejs/core';
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
  const { displaySetService, uiNotificationService, hangingProtocolService } =
    servicesManager.services;

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

    try {
      if (isPmapVisible) {
        // --- LOGIC TO HIDE (REVERT TO ORIGINAL) ---
        const originalDisplaySetUID = sessionStorage.getItem(
          `${ORIGINAL_DS_UID_KEY}_${viewportId}` // Uses consistent viewportId
        );

        if (!originalDisplaySetUID) {
          // This is the error you are seeing. The fix ensures this won't happen.
          console.error('Original DisplaySet UID not found in session. Cannot revert.');
          return;
        }

        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          activeViewportId,
          originalDisplaySetUID,
          isHangingProtocolLayout
        );

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
    }

    viewportGridService.setDisplaySetsForViewports(updatedViewports);
  };

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

        {/* 🔹 Updated Explain Button */}
        <button
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
        </button>
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
