import { DisplaySetService, ViewportGridService } from '@ohif/core';

const IMAGE_SLICE_SYNC_NAME = 'IMAGE_SLICE_SYNC';

export default function toggleImageSliceSync({
  servicesManager,
  viewports: providedViewports,
  syncId,
}: withAppTypes) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;

  syncId ||= IMAGE_SLICE_SYNC_NAME;

  const viewports =
    providedViewports || getReconstructableStackViewports(viewportGridService, displaySetService);

  // Todo: right now we don't have a proper way to define specific
  // viewports to add to synchronizers, and right now it is global or not
  // after we do that, we should do fine grained control of the synchronizers
  const someViewportHasSync = viewports.some(viewport => {
    const syncStates = syncGroupService.getSynchronizersForViewport(
      viewport.viewportOptions.viewportId
    );

    const imageSync = syncStates.find(syncState => syncState.id === syncId);

    return !!imageSync;
  });

  if (someViewportHasSync) {
    return disableSync(syncId, servicesManager);
  }

  // create synchronization group and add the viewports to it.
  let syncedViewportCount = 0;

  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
      type: 'imageSlice',
      id: syncId,
      source: true,
      target: true,
    });
    syncedViewportCount++;
  });

  if (syncedViewportCount < 2) {
    console.warn(
      `Image slice synchronization requires at least two reconstructable viewports. ` +
        `Found ${syncedViewportCount}.`
    );
  }

  const synchronizer = syncGroupService.getSynchronizer(syncId);
  synchronizer?.setEnabled(true);
}

function disableSync(syncName, servicesManager: AppTypes.ServicesManager) {
  const { syncGroupService, viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;
  const viewports = getReconstructableStackViewports(viewportGridService, displaySetService);
  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.removeViewportFromSyncGroup(
      viewport.id,
      viewport.getRenderingEngine().id,
      syncName
    );
  });
}

/**
 * Gets the consistent spacing stack viewport types, which are the ones which
 * can be navigated using the stack image sync right now.
 */
function getReconstructableStackViewports(
  viewportGridService: ViewportGridService,
  displaySetService: DisplaySetService
) {
  const gridState = viewportGridService.getState();
  const allViewports = [...gridState.viewports.values()].filter(
    viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
  );

  const reconstructable = allViewports.filter(viewport => {
    const { displaySetInstanceUIDs } = viewport;

    for (const displaySetInstanceUID of displaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      // TODO - add a better test than isReconstructable
      if (displaySet && displaySet.isReconstructable) {
        return true;
      }

      return false;
    }
  });

  if (reconstructable.length >= 2) {
    return reconstructable;
  }

  // Fall back to all populated viewports when fewer than two reconstructable stacks are found.
  return allViewports;
}
