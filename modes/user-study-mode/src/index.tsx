import { hotkeys } from '@ohif/core';
import { initToolGroups, toolbarButtons, moreTools } from '@ohif/mode-longitudinal';
import { StackViewport, VolumeViewport, utilities as csUtils } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';
import { id } from './id';

const treatmentCondition = 'enhanced';

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  hangingProtocol: '@ohif/extension-default.hangingProtocolModule.default',
};

const cornerstone = {
  viewport: '@ohif/extension-cornerstone.viewportModule.cornerstone',
};

const dicomPmap = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-pmap.sopClassHandlerModule.dicom-pmap',
  viewport: '@ohif/extension-cornerstone-dicom-pmap.viewportModule.dicom-pmap',
};

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

let userStudyCleanupFns: Array<() => void> = [];

/**
 * Just two dependencies to be able to render a viewport with panels in order
 * to make sure that the mode is working.
 */
const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-pmap': '^3.0.0',
};

// modesConfiguration: {
//   '@ohif/mode-longitudinal': {
//     displayName: 'Custom Name',
//     routeName: 'customRouteName',
//       routes: [
//         {
//           path: 'customPath',
//           layoutTemplate: () => {
//             /** Custom Layout */
//             return {
//               id: ohif.layout,
//               props: {
//                 leftPanels: [tracked.thumbnailList],
//                 rightPanels: [dicomSeg.panel, tracked.measurements],
//                 rightPanelClosed: true,
//                 viewports: [
//                   {
//                     namespace: tracked.viewport,
//                     displaySetsToDisplay: [ohif.sopClassHandler],
//                   },
//                 ],
//               },
//             };
//           },
//         },
//       ],
//   }
// },

function modeFactory({ modeConfiguration }) {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'user-study-mode',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'Participant Study',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: withAppTypes) => {
      userStudyCleanupFns.forEach(fn => fn?.());
      userStudyCleanupFns = [];

      const { measurementService, toolbarService, toolGroupService } = servicesManager.services;

      measurementService.clearMeasurements();

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      toolbarService.addButtons([...toolbarButtons, ...moreTools]);
      toolbarService.createButtonSection('primary', [
        'MeasurementTools',
        'Zoom',
        'WindowLevel',
        'Pan',
        'Capture',
        'Layout',
        'ImageSliceSync',
        'Crosshairs',
        'MoreTools',
      ]);

      const { viewportGridService, cornerstoneViewportService, displaySetService } =
        servicesManager.services;

      const cleanupFns: Array<() => void> = [];
      const registerCleanup = (fn?: () => void) => {
        if (typeof fn === 'function') {
          cleanupFns.push(fn);
        }
      };

      const dispose = () => {
        while (cleanupFns.length) {
          const fn = cleanupFns.pop();
          try {
            fn?.();
          } catch (err) {
            console.warn('Error during user study cleanup', err);
          }
        }
        userStudyCleanupFns = [];
      };

      let hasAppliedDefaultSlice = false;

      const applyDefaultSlice = () => {
        if (hasAppliedDefaultSlice) {
          return true;
        }

        const state =
          viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
        const viewports = getViewportsArray(state);
        if (!viewports.length) {
          return false;
        }

        let applied = false;

        for (const vp of viewports) {
          const viewportId = vp?.viewportId;
          if (!viewportId) {
            continue;
          }

          const viewport = cornerstoneViewportService.getCornerstoneViewport?.(viewportId);
          if (!viewport) {
            continue;
          }

          let numberOfSlices = 0;

          if (viewport instanceof StackViewport) {
            numberOfSlices = viewport.getImageIds?.()?.length ?? 0;
          } else if (viewport instanceof VolumeViewport) {
            const sliceData = csUtils.getImageSliceDataForVolumeViewport?.(viewport);
            numberOfSlices = sliceData?.numberOfSlices ?? 0;
          }

          if (!numberOfSlices) {
            continue;
          }

          const maxIndex = Math.max(numberOfSlices - 1, 0);
          const targetIndex = Math.min(128, maxIndex);

          jumpToSlice(viewport.element, { imageIndex: targetIndex });
          applied = true;
        }

        if (applied) {
          hasAppliedDefaultSlice = true;
          dispose();
        }

        return applied;
      };

      const handleViewportEvent = () => {
        applyDefaultSlice();
      };

      const readySub =
        viewportGridService?.subscribe?.(
          viewportGridService.EVENTS?.VIEWPORTS_READY || 'event::viewportsReady',
          handleViewportEvent
        ) || null;
      registerCleanup(() => readySub?.unsubscribe?.());

      const gridSub =
        viewportGridService?.subscribe?.(
          viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'event::gridStateChanged',
          handleViewportEvent
        ) || null;
      registerCleanup(() => gridSub?.unsubscribe?.());

      const displaySetSub =
        displaySetService?.subscribe?.(
          displaySetService.EVENTS?.DISPLAY_SETS_ADDED || 'DISPLAY_SETS_ADDED',
          handleViewportEvent
        ) || null;
      registerCleanup(() => displaySetSub?.unsubscribe?.());

      const timeouts: Array<number> = [];
      const scheduleAttempt = (delay: number) => {
        const timeoutId = window.setTimeout(() => {
          applyDefaultSlice();
        }, delay);
        timeouts.push(timeoutId);
      };

      [0, 200, 500, 1000].forEach(scheduleAttempt);
      registerCleanup(() => {
        timeouts.forEach(id => window.clearTimeout(id));
      });

      registerCleanup(() => {
        hasAppliedDefaultSlice = true;
      });

      userStudyCleanupFns = cleanupFns;
    },
    onModeExit: ({ servicesManager }: withAppTypes) => {
      userStudyCleanupFns.forEach(fn => fn?.());
      userStudyCleanupFns = [];

      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      uiDialogService.dismissAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    /** */
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. For instance a PET/CT mode should be
     */
    isValidMode: ({ modalities, study, treatmentCondition }) => {
      // if (treatmentCondition == 'enhanced') {
      //   return { valid: true};
      // }
      return { valid: true };
    },
    /**
     * Mode Routes are used to define the mode's behavior. A list of Mode Route
     * that includes the mode's path and the layout to be used. The layout will
     * include the components that are used in the layout. For instance, if the
     * default layoutTemplate is used (id: '@ohif/extension-default.layoutTemplateModule.viewerLayout')
     * it will include the leftPanels, rightPanels, and viewports. However, if
     * you define another layoutTemplate that includes a Footer for instance,
     * you should provide the Footer component here too. Note: We use Strings
     * to reference the component's ID as they are registered in the internal
     * ExtensionManager. The template for the string is:
     * `${extensionId}.{moduleType}.${componentId}`.
     */
    routes: [
      {
        path: 'user-study-mode',
        layoutTemplate: ({ location, servicesManager }) => {
          let rightPanels;
          if (treatmentCondition === 'enhanced') {
            rightPanels = [['user-study-extension.panelModule.explanation-panel']];
          } else {
            rightPanels = [['user-study-extension.panelModule.standard-panel']];
          }
          return {
            id: ohif.layout,
            props: {
              leftPanels: [],
              rightPanels,
              rightPanelClosed: true,
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
                {
                  namespace: dicomPmap.viewport,
                  displaySetsToDisplay: [dicomPmap.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    hangingProtocol: 'default',
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [ohif.sopClassHandler, dicomPmap.sopClassHandler],
    /** hotkeys for mode */
    hotkeys: [...hotkeys.defaults.hotkeyBindings],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
