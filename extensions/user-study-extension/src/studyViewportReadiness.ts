import { useCallback, useEffect, useState } from 'react';

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  const { viewports } = state;
  if (Array.isArray(viewports)) {
    return viewports;
  }
  if (typeof viewports?.values === 'function') {
    return Array.from(viewports.values());
  }
  if (typeof viewports === 'object') {
    return Object.values(viewports);
  }

  return [];
};

const getViewportDisplaySetUID = (viewportEntry: any): string | null => {
  const directUID = viewportEntry?.displaySetInstanceUIDs?.[0];
  if (directUID) {
    return directUID;
  }

  const optionUID = viewportEntry?.displaySetOptions?.[0]?.displaySetInstanceUID;
  if (optionUID) {
    return optionUID;
  }

  return null;
};

const hasRenderableViewportData = (cornerstoneViewport: any): boolean => {
  if (!cornerstoneViewport) {
    return false;
  }

  // If this API exists, trust it as the source of truth for renderable content.
  // Viewport labels like 1/0 correspond to getNumberOfSlices() === 0.
  if (typeof cornerstoneViewport.getNumberOfSlices === 'function') {
    const numberOfSlices = cornerstoneViewport.getNumberOfSlices();
    if (typeof numberOfSlices !== 'number' || !Number.isFinite(numberOfSlices)) {
      return false;
    }
    return numberOfSlices > 0;
  }

  // Fallback for viewports that don't expose slice count.
  // Require real image data plus image ids, not just placeholder metadata.
  let hasImageData = false;
  try {
    hasImageData = Boolean(cornerstoneViewport.getImageData?.());
  } catch {
    hasImageData = false;
  }
  if (!hasImageData) {
    return false;
  }

  const imageIds = cornerstoneViewport.getImageIds?.() || [];
  const currentImageId = cornerstoneViewport.getCurrentImageId?.();
  const hasImageIds = Array.isArray(imageIds) && imageIds.length > 0;
  const hasCurrentImageId = typeof currentImageId === 'string' && currentImageId.length > 0;

  return hasImageIds || hasCurrentImageId;
};

export const areStudyViewportImagesReady = (servicesManager: any): boolean => {
  const { viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager?.services ?? {};

  if (!viewportGridService || !displaySetService || !cornerstoneViewportService) {
    return false;
  }

  const gridState =
    viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
  const viewports = getViewportsArray(gridState);
  if (!viewports.length) {
    return false;
  }

  const relevantViewports = viewports.filter(vp => !!getViewportDisplaySetUID(vp));
  if (!relevantViewports.length) {
    return false;
  }

  return relevantViewports.every(vp => {
    const displaySetUID = getViewportDisplaySetUID(vp);
    if (!displaySetUID) {
      return false;
    }

    const displaySet = displaySetService.getDisplaySetByUID?.(displaySetUID);
    if (!displaySet) {
      return false;
    }

    const isDisplaySetLoading = Boolean(
      displaySet.loading || displaySet.isLoading || displaySet.loadStatus?.loading
    );
    if (isDisplaySetLoading) {
      return false;
    }

    const hasDisplaySetContent =
      (Array.isArray(displaySet.instances) && displaySet.instances.length > 0) ||
      (Array.isArray(displaySet.images) && displaySet.images.length > 0) ||
      Number(displaySet.numImageFrames || 0) > 0;
    if (!hasDisplaySetContent) {
      return false;
    }

    const viewportId = vp?.viewportId;
    if (!viewportId) {
      return false;
    }

    const cornerstoneViewport = cornerstoneViewportService.getCornerstoneViewport?.(viewportId);
    return hasRenderableViewportData(cornerstoneViewport);
  });
};

export const useStudyViewportImagesReady = (
  servicesManager: any,
  resetKey: string | null | undefined
): boolean => {
  const [imagesReady, setImagesReady] = useState(false);

  const evaluateImageReadiness = useCallback(() => {
    const ready = areStudyViewportImagesReady(servicesManager);
    setImagesReady(previousValue => (previousValue === ready ? previousValue : ready));
    return ready;
  }, [servicesManager]);

  useEffect(() => {
    const { viewportGridService, displaySetService } = servicesManager?.services ?? {};

    setImagesReady(false);
    evaluateImageReadiness();

    const subscriptions: Array<{ unsubscribe?: () => void } | null> = [];
    const subscribe = (service: any, eventName: string) => {
      if (!service?.subscribe || !eventName) {
        return;
      }
      const sub = service.subscribe(eventName, evaluateImageReadiness);
      subscriptions.push(sub || null);
    };

    subscribe(
      viewportGridService,
      viewportGridService?.EVENTS?.VIEWPORTS_READY || 'event::viewportsReady'
    );
    subscribe(
      viewportGridService,
      viewportGridService?.EVENTS?.GRID_STATE_CHANGED || 'event::gridStateChanged'
    );
    subscribe(displaySetService, displaySetService?.EVENTS?.DISPLAY_SETS_ADDED || 'DISPLAY_SETS_ADDED');
    subscribe(
      displaySetService,
      displaySetService?.EVENTS?.DISPLAY_SETS_CHANGED || 'DISPLAY_SETS_CHANGED'
    );
    subscribe(
      displaySetService,
      displaySetService?.EVENTS?.DISPLAY_SET_SERIES_METADATA_INVALIDATED ||
        'DISPLAY_SET_SERIES_METADATA_INVALIDATED'
    );

    const pollingIntervalId = window.setInterval(() => {
      evaluateImageReadiness();
    }, 300);

    return () => {
      subscriptions.forEach(sub => sub?.unsubscribe?.());
      window.clearInterval(pollingIntervalId);
    };
  }, [evaluateImageReadiness, resetKey, servicesManager]);

  return imagesReady;
};
