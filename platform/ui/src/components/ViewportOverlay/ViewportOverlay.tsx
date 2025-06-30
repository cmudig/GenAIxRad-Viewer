import React from 'react';
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
  const { displaySetService, uiNotificationService, hangingProtocolService } = servicesManager.services;

  const handleExplainClick = async (event) => {
    let updatedViewports = [];
    console.log(' Explain button clicked');

    let viewportElement = event.currentTarget
      .closest('.viewport-wrapper')
      ?.querySelector('.cornerstone-viewport-element');
    // if (!viewportElement) {
    //   viewportElement = document.querySelector('.cornerstone-viewport-element');
    // }

    const viewportId = viewportElement.getAttribute('data-viewport-uid');

    const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');

    const viewport = renderingEngine.getViewport(viewportId);
    const imageId = viewport.getCurrentImageId();
    const seriesInstanceUID = metaData.get('SeriesInstanceUID', imageId);
    // const primaryDisplaySetInstanceUID = viewportGridService.getDisplaySetsUIDsForViewport(viewportId)?.[0]; //double check this
    // console.log(primaryDisplaySetInstanceUID);
    const allDisplaySets = displaySetService.getActiveDisplaySets();

    console.log(allDisplaySets);

    const pmapDisplaySet = allDisplaySets.find(
      ds =>
        ds.referencedSeriesInstanceUID === seriesInstanceUID &&
        ds.SOPClassUID === '1.2.840.10008.5.1.4.1.1.30'
    );


    if (!pmapDisplaySet) {
      console.warn('❌ No pMap display set found for this series!');
      return;
    }
    console.log(pmapDisplaySet)

    try {
      updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        activeViewportId,
        pmapDisplaySet.displaySetInstanceUID,
        isHangingProtocolLayout
      );
    } catch (error) {
      console.warn(error);
      uiNotificationService.show({
        title: 'Thumbnail Double Click',
        message: 'The selected display sets could not be added to the viewport.',
        type: 'error',
        duration: 3000,
      });
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
          Explain
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
