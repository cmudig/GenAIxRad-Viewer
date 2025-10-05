import OHIF, { errorHandler } from '@ohif/core';
import React from 'react';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import {
  init as cs3DInit,
  eventTarget,
  EVENTS,
  metaData,
  volumeLoader,
  imageLoadPoolManager,
  getEnabledElement,
  Settings,
  utilities as csUtilities,
} from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';

import RequestTypes from '@cornerstonejs/core/enums/RequestType';

import initWADOImageLoader from './initWADOImageLoader';
import initCornerstoneTools from './initCornerstoneTools';

import { connectToolsToMeasurementService } from './initMeasurementService';
import initCineService from './initCineService';
import initStudyPrefetcherService from './initStudyPrefetcherService';
import interleaveCenterLoader from './utils/interleaveCenterLoader';
import nthLoader from './utils/nthLoader';
import interleaveTopToBottom from './utils/interleaveTopToBottom';
import initContextMenu from './initContextMenu';
import initDoubleClick from './initDoubleClick';
import initViewTiming from './utils/initViewTiming';
import { colormaps } from './utils/colormaps';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import { useLutPresentationStore } from './stores/useLutPresentationStore';
import { usePositionPresentationStore } from './stores/usePositionPresentationStore';
import { useSegmentationPresentationStore } from './stores/useSegmentationPresentationStore';
import { imageRetrieveMetadataProvider } from '@cornerstonejs/core/utilities';

const { registerColormap } = csUtilities.colormap;

const MAX_RENDERER_READY_ATTEMPTS = 10;

function patchViewportAddActors(): void {
  const viewportProto = (cornerstone as any).Viewport?.prototype as Record<string, any> | undefined;

  if (!viewportProto || viewportProto.__rendererReadyGuardInstalled) {
    return;
  }

  const originalAddActors = viewportProto.addActors;

  viewportProto.addActors = function addActorsWithRendererGuard(
    actors: Array<any>,
    options: Record<string, any> = {}
  ) {
    const self = this as Record<string, any>;

    const tryAddActors = () => {
      if (self.isDisabled) {
        return true;
      }

      const renderingEngine = self.getRenderingEngine?.();
      if (!renderingEngine || renderingEngine.hasBeenDestroyed) {
        return false;
      }

      const renderer = renderingEngine.offscreenMultiRenderWindow?.getRenderer(self.id);
      if (!renderer) {
        return false;
      }

      const vtkCamera = renderer.getActiveCamera?.();
      if (!vtkCamera) {
        return false;
      }

      originalAddActors.call(self, actors, options);
      return true;
    };

    if (tryAddActors()) {
      return;
    }

    let attempts = 0;
    const schedule = (callback: (timestamp: number) => void) => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(callback);
      } else {
        setTimeout(() => callback(Date.now()), 16);
      }
    };

    const retry = () => {
      if (self.isDisabled || !self.element?.isConnected) {
        return;
      }

      if (tryAddActors()) {
        return;
      }

      attempts += 1;

      if (attempts >= MAX_RENDERER_READY_ATTEMPTS) {
        console.warn(
          `Viewport ${self.id}: renderer not ready after ${MAX_RENDERER_READY_ATTEMPTS} attempts; skipping addActors.`
        );
        return;
      }

      schedule(retry);
    };

    schedule(retry);
  };

  viewportProto.__rendererReadyGuardInstalled = true;
}

// TODO: Cypress tests are currently grabbing this from the window?
(window as any).cornerstone = cornerstone;
(window as any).cornerstoneTools = cornerstoneTools;
/**
 *
 */
export default async function init({
  servicesManager,
  commandsManager,
  extensionManager,
  appConfig,
}: withAppTypes): Promise<void> {
  // Note: this should run first before initializing the cornerstone
  // DO NOT CHANGE THE ORDER

  await cs3DInit({
    peerImport: appConfig.peerImport,
  });

  // For debugging e2e tests that are failing on CI
  cornerstone.setUseCPURendering(Boolean(appConfig.useCPURendering));

  cornerstone.setConfiguration({
    ...cornerstone.getConfiguration(),
    rendering: {
      ...cornerstone.getConfiguration().rendering,
      strictZSpacingForVolumeViewport: appConfig.strictZSpacingForVolumeViewport,
    },
  });

  patchViewportAddActors();

  // For debugging large datasets, otherwise prefer the defaults
  const { maxCacheSize } = appConfig;
  if (maxCacheSize) {
    cornerstone.cache.setMaxCacheSize(maxCacheSize);
  }

  initCornerstoneTools();

  Settings.getRuntimeSettings().set('useCursors', Boolean(appConfig.useCursors));

  const {
    userAuthenticationService,
    customizationService,
    uiModalService,
    uiNotificationService,
    cornerstoneViewportService,
    hangingProtocolService,
    viewportGridService,
  } = servicesManager.services;

  window.services = servicesManager.services;
  window.extensionManager = extensionManager;
  window.commandsManager = commandsManager;

  if (appConfig.showCPUFallbackMessage && cornerstone.getShouldUseCPURendering()) {
    _showCPURenderingModal(uiModalService, hangingProtocolService);
  }
  const { getPresentationId: getLutPresentationId } = useLutPresentationStore.getState();

  const { getPresentationId: getSegmentationPresentationId } =
    useSegmentationPresentationStore.getState();

  const { getPresentationId: getPositionPresentationId } = usePositionPresentationStore.getState();

  // register presentation id providers
  viewportGridService.addPresentationIdProvider(
    'positionPresentationId',
    getPositionPresentationId
  );
  viewportGridService.addPresentationIdProvider('lutPresentationId', getLutPresentationId);
  viewportGridService.addPresentationIdProvider(
    'segmentationPresentationId',
    getSegmentationPresentationId
  );

  cornerstoneTools.segmentation.config.style.setStyle(
    { type: SegmentationRepresentations.Contour },
    {
      renderFill: false,
    }
  );

  const metadataProvider = OHIF.classes.MetadataProvider;

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingImageVolume',
    cornerstoneStreamingImageVolumeLoader
  );

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  // Register strategies using the wrapper
  const imageLoadStrategies = {
    interleaveCenter: interleaveCenterLoader,
    interleaveTopToBottom: interleaveTopToBottom,
    nth: nthLoader,
  };

  Object.entries(imageLoadStrategies).forEach(([name, strategyFn]) => {
    hangingProtocolService.registerImageLoadStrategy(
      name,
      createMetadataWrappedStrategy(strategyFn)
    );
  });

  // ... existing code ...

  // add metadata providers
  metaData.addProvider(
    csUtilities.calibratedPixelSpacingMetadataProvider.get.bind(
      csUtilities.calibratedPixelSpacingMetadataProvider
    )
  ); // this provider is required for Calibration tool
  metaData.addProvider(metadataProvider.get.bind(metadataProvider), 9999);

  // These are set reasonably low to allow for interleaved retrieves and slower
  // connections.
  imageLoadPoolManager.maxNumRequests = {
    [RequestTypes.Interaction]: appConfig?.maxNumRequests?.interaction || 10,
    [RequestTypes.Thumbnail]: appConfig?.maxNumRequests?.thumbnail || 5,
    [RequestTypes.Prefetch]: appConfig?.maxNumRequests?.prefetch || 5,
    [RequestTypes.Compute]: appConfig?.maxNumRequests?.compute || 10,
  };

  initWADOImageLoader(userAuthenticationService, appConfig, extensionManager);

  /* Measurement Service */
  this.measurementServiceSource = connectToolsToMeasurementService(servicesManager);

  initCineService(servicesManager);
  initStudyPrefetcherService(servicesManager);

  // When a custom image load is performed, update the relevant viewports
  hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.CUSTOM_IMAGE_LOAD_PERFORMED,
    volumeInputArrayMap => {
      const { lutPresentationStore } = useLutPresentationStore.getState();
      const { segmentationPresentationStore } = useSegmentationPresentationStore.getState();
      const { positionPresentationStore } = usePositionPresentationStore.getState();

      for (const entry of volumeInputArrayMap.entries()) {
        const [viewportId, volumeInputArray] = entry;
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

        const ohifViewport = cornerstoneViewportService.getViewportInfo(viewportId);

        const { presentationIds } = ohifViewport.getViewportOptions();

        const presentations = {
          positionPresentation: positionPresentationStore[presentationIds?.positionPresentationId],
          lutPresentation: lutPresentationStore[presentationIds?.lutPresentationId],
          segmentationPresentation:
            segmentationPresentationStore[presentationIds?.segmentationPresentationId],
        };

        cornerstoneViewportService.setVolumesForViewport(viewport, volumeInputArray, presentations);
      }
    }
  );

  // resize the cornerstone viewport service when the grid size changes
  // IMPORTANT: this should happen outside of the OHIFCornerstoneViewport
  // since it will trigger a rerender of each viewport and each resizing
  // the offscreen canvas which would result in a performance hit, this should
  // done only once per grid resize here. Doing it once here, allows us to reduce
  // the refreshRage(in ms) to 10 from 50. I tried with even 1 or 5 ms it worked fine
  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_SIZE_CHANGED, () => {
    cornerstoneViewportService.resize(true);
  });

  initContextMenu({
    cornerstoneViewportService,
    customizationService,
    commandsManager,
  });

  initDoubleClick({
    customizationService,
    commandsManager,
  });

  /**
   * Runs error handler for failed requests.
   * @param event
   */
  const imageLoadFailedHandler = ({ detail }) => {
    const handler = errorHandler.getHTTPErrorHandler();
    handler(detail.error);
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, imageLoadFailedHandler);
  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_ERROR, imageLoadFailedHandler);

  function elementEnabledHandler(evt) {
    const { element } = evt.detail;

    element.addEventListener(EVENTS.CAMERA_RESET, evt => {
      const { element } = evt.detail;
      const enabledElement = getEnabledElement(element);
      if (!enabledElement) {
        return;
      }
      const { viewportId } = enabledElement;
      commandsManager.runCommand('resetCrosshairs', { viewportId });
    });

    initViewTiming({ element });
  }

  eventTarget.addEventListener(EVENTS.ELEMENT_ENABLED, elementEnabledHandler.bind(null));

  colormaps.forEach(registerColormap);

  // Event listener
  eventTarget.addEventListenerDebounced(
    EVENTS.ERROR_EVENT,
    ({ detail }) => {
      uiNotificationService.show({
        title: detail.type,
        message: detail.message,
        type: 'error',
      });
    },
    100
  );

  // Call this function when initializing
  initializeWebWorkerProgressHandler(servicesManager.services.uiNotificationService);
}

function initializeWebWorkerProgressHandler(uiNotificationService) {
  const activeToasts = new Map();

  eventTarget.addEventListener(EVENTS.WEB_WORKER_PROGRESS, ({ detail }) => {
    const { progress, type, id } = detail;

    const cacheKey = `${type}-${id}`;
    if (progress === 0 && !activeToasts.has(cacheKey)) {
      const progressPromise = new Promise((resolve, reject) => {
        activeToasts.set(cacheKey, { resolve, reject });
      });

      uiNotificationService.show({
        id: cacheKey,
        title: `${type}`,
        message: `${type}: ${progress}%`,
        autoClose: false,
        promise: progressPromise,
        promiseMessages: {
          loading: `Computing...`,
          success: `Completed successfully`,
          error: 'Web Worker failed',
        },
      });
    } else {
      if (progress === 100) {
        const { resolve } = activeToasts.get(cacheKey);
        resolve({ progress, type });
        activeToasts.delete(cacheKey);
      }
    }
  });
}

/**
 * Creates a wrapped image load strategy with metadata handling
 * @param strategyFn - The image loading strategy function to wrap
 * @returns A wrapped strategy function that handles metadata configuration
 */
const createMetadataWrappedStrategy = (strategyFn: (args: any) => any) => {
  return (args: any) => {
    const clonedConfig = imageRetrieveMetadataProvider.clone();
    imageRetrieveMetadataProvider.clear();

    try {
      const result = strategyFn(args);
      return result;
    } finally {
      // Ensure metadata is always restored, even if there's an error
      setTimeout(() => {
        imageRetrieveMetadataProvider.restore(clonedConfig);
      }, 10);
    }
  };
};

function CPUModal() {
  return (
    <div>
      <p>
        Your computer does not have enough GPU power to support the default GPU rendering mode. OHIF
        has switched to CPU rendering mode. Please note that CPU rendering does not support all
        features such as Volume Rendering, Multiplanar Reconstruction, and Segmentation Overlays.
      </p>
    </div>
  );
}

function _showCPURenderingModal(uiModalService, hangingProtocolService) {
  const callback = progress => {
    if (progress === 100) {
      uiModalService.show({
        content: CPUModal,
        title: 'OHIF Fell Back to CPU Rendering',
      });

      return true;
    }
  };

  const { unsubscribe } = hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    () => {
      const done = callback(100);

      if (done) {
        unsubscribe();
      }
    }
  );
}
