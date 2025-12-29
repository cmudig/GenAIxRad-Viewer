/** @type {AppTypes.Config} */

window.config = {
  routerBasename: '/',
  // whiteLabeling: {},
  extensions: [],
  modes: [],
  customizationService: {},
  showStudyList: true,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  gemini: {
    endpoint:
      'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent',
    model: 'gemini-2.5-flash',
    temperature: 1,
  },
  // filterQueryParam: false,
  defaultDataSourceName: 'orthanc',
  /* Dynamic config allows user to pass "configUrl" query string this allows to load config without recompiling application. The regex will ensure valid configuration source */
  // dangerouslyUseDynamicConfig: {
  //   enabled: true,
  //   // regex will ensure valid configuration source and default is /.*/ which matches any character. To use this, setup your own regex to choose a specific source of configuration only.
  //   // Example 1, to allow numbers and letters in an absolute or sub-path only.
  //   // regex: /(0-9A-Za-z.]+)(\/[0-9A-Za-z.]+)*/
  //   // Example 2, to restricts to either hosptial.com or othersite.com.
  //   // regex: /(https:\/\/hospital.com(\/[0-9A-Za-z.]+)*)|(https:\/\/othersite.com(\/[0-9A-Za-z.]+)*)/
  //   regex: /.*/,
  // },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'Orthanc DICOMweb Server',
        wadoUriRoot: 'https://orthanc.katelyncmorrison.com/wado',
        qidoRoot: 'https://orthanc.katelyncmorrison.com/pacs',
        wadoRoot: 'https://orthanc.katelyncmorrison.com/pacs',
        qidoSupportsIncludeField: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb_old',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif2',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif3',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        wadoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local5000',
      configuration: {
        friendlyName: 'Static WADO Local Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:5000/dicomweb',
        wadoRoot: 'http://localhost:5000/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomwebproxy',
      sourceName: 'dicomwebproxy',
      configuration: {
        friendlyName: 'dicomweb delegating proxy',
        name: 'dicomwebproxy',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Orthanc Server',
        name: 'Orthanc',
        wadoUriRoot: 'https://orthanc.katelyncmorrison.com/wado',
        qidoRoot: 'https://orthanc.katelyncmorrison.com/dicom-web/',
        wadoRoot: 'https://orthanc.katelyncmorrison.com/dicom-web/',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
      },
    },
  ],
  httpErrorHandler: error => {
    // This is 429 when rejected from the public idc sandbox too often.
    console.warn(error.status);

    // Could use services manager here to bring up a dialog/modal if needed.
    console.warn('test, navigate to https://ohif.org/');
  },
  // whiteLabeling: {
  //   /* Optional: Should return a React component to be rendered in the "Logo" section of the application's Top Navigation bar */
  //   createLogoComponentFn: function (React) {
  //     return React.createElement(
  //       'a',
  //       {
  //         target: '_self',
  //         rel: 'noopener noreferrer',
  //         className: 'text-purple-600 line-through',
  //         href: '/',
  //       },
  //       React.createElement('img',
  //         {
  //           src: './assets/customLogo.svg',
  //           className: 'w-8 h-8',
  //         }
  //       ))
  //   },
  // },
  hotkeys: [
    {
      commandName: 'incrementActiveViewport',
      label: 'Next Viewport',
      keys: ['right'],
    },
    {
      commandName: 'decrementActiveViewport',
      label: 'Previous Viewport',
      keys: ['left'],
    },
    { commandName: 'rotateViewportCW', label: 'Rotate Right', keys: ['r'] },
    { commandName: 'rotateViewportCCW', label: 'Rotate Left', keys: ['l'] },
    { commandName: 'invertViewport', label: 'Invert', keys: ['i'] },
    {
      commandName: 'flipViewportHorizontal',
      label: 'Flip Horizontally',
      keys: ['h'],
    },
    {
      commandName: 'flipViewportVertical',
      label: 'Flip Vertically',
      keys: ['v'],
    },
    { commandName: 'scaleUpViewport', label: 'Zoom In', keys: ['+'] },
    { commandName: 'scaleDownViewport', label: 'Zoom Out', keys: ['-'] },
    { commandName: 'fitViewportToWindow', label: 'Zoom to Fit', keys: ['='] },
    { commandName: 'resetViewport', label: 'Reset', keys: ['space'] },
    { commandName: 'nextImage', label: 'Next Image', keys: ['down'] },
    { commandName: 'previousImage', label: 'Previous Image', keys: ['up'] },
    // {
    //   commandName: 'previousViewportDisplaySet',
    //   label: 'Previous Series',
    //   keys: ['pagedown'],
    // },
    // {
    //   commandName: 'nextViewportDisplaySet',
    //   label: 'Next Series',
    //   keys: ['pageup'],
    // },
    {
      commandName: 'setToolActive',
      commandOptions: { toolName: 'Zoom' },
      label: 'Zoom',
      keys: ['z'],
    },
    // ~ Window level presets
    {
      commandName: 'windowLevelPreset1',
      label: 'W/L Preset 1',
      keys: ['1'],
    },
    {
      commandName: 'windowLevelPreset2',
      label: 'W/L Preset 2',
      keys: ['2'],
    },
    {
      commandName: 'windowLevelPreset3',
      label: 'W/L Preset 3',
      keys: ['3'],
    },
    {
      commandName: 'windowLevelPreset4',
      label: 'W/L Preset 4',
      keys: ['4'],
    },
    {
      commandName: 'windowLevelPreset5',
      label: 'W/L Preset 5',
      keys: ['5'],
    },
    {
      commandName: 'windowLevelPreset6',
      label: 'W/L Preset 6',
      keys: ['6'],
    },
    {
      commandName: 'windowLevelPreset7',
      label: 'W/L Preset 7',
      keys: ['7'],
    },
    {
      commandName: 'windowLevelPreset8',
      label: 'W/L Preset 8',
      keys: ['8'],
    },
    {
      commandName: 'windowLevelPreset9',
      label: 'W/L Preset 9',
      keys: ['9'],
    },
  ],
  tours: [
    {
      id: 'basicViewerTour',
      route: '/viewer',
      steps: [
        {
          id: 'scroll',
          title: 'Scrolling Through Images',
          text: 'You can scroll through the images using the mouse wheel or scrollbar.',
          attachTo: {
            element: '.viewport-element',
            on: 'top',
          },
          advanceOn: {
            selector: '.cornerstone-viewport-element',
            event: 'CORNERSTONE_TOOLS_MOUSE_WHEEL',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'zoom',
          title: 'Zooming In and Out',
          text: 'You can zoom the images using the right click.',
          attachTo: {
            element: '.viewport-element',
            on: 'left',
          },
          advanceOn: {
            selector: '.cornerstone-viewport-element',
            event: 'CORNERSTONE_TOOLS_MOUSE_UP',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'pan',
          title: 'Panning the Image',
          text: 'You can pan the images using the middle click.',
          attachTo: {
            element: '.viewport-element',
            on: 'top',
          },
          advanceOn: {
            selector: '.cornerstone-viewport-element',
            event: 'CORNERSTONE_TOOLS_MOUSE_UP',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'windowing',
          title: 'Adjusting Window Level',
          text: 'You can modify the window level using the left click.',
          attachTo: {
            element: '.viewport-element',
            on: 'left',
          },
          advanceOn: {
            selector: '.cornerstone-viewport-element',
            event: 'CORNERSTONE_TOOLS_MOUSE_UP',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'length',
          title: 'Using the Measurement Tools',
          text: 'You can measure the length of a region using the Length tool.',
          attachTo: {
            element: '[data-cy="MeasurementTools-split-button-primary"]',
            on: 'bottom',
          },
          advanceOn: {
            selector: '[data-cy="MeasurementTools-split-button-primary"]',
            event: 'click',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="MeasurementTools-split-button-primary"]'),
        },
        {
          id: 'drawAnnotation',
          title: 'Drawing Length Annotations',
          text: 'Use the length tool on the viewport to measure the length of a region.',
          attachTo: {
            element: '.viewport-element',
            on: 'right',
          },
          advanceOn: {
            selector: 'body',
            event: 'event::measurement_added',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'trackMeasurement',
          title: 'Tracking Measurements in the Panel',
          text: 'Click yes to track the measurements in the measurement panel.',
          attachTo: {
            element: '[data-cy="prompt-begin-tracking-yes-btn"]',
            on: 'bottom',
          },
          advanceOn: {
            selector: '[data-cy="prompt-begin-tracking-yes-btn"]',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="prompt-begin-tracking-yes-btn"]'),
        },
        {
          id: 'openMeasurementPanel',
          title: 'Opening the Measurements Panel',
          text: 'Click the measurements button to open the measurements panel.',
          attachTo: {
            element: '#trackedMeasurements-btn',
            on: 'left-start',
          },
          advanceOn: {
            selector: '#trackedMeasurements-btn',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('#trackedMeasurements-btn'),
        },
        {
          id: 'scrollAwayFromMeasurement',
          title: 'Scrolling Away from a Measurement',
          text: 'Scroll the images using the mouse wheel away from the measurement.',
          attachTo: {
            element: '.viewport-element',
            on: 'left',
          },
          advanceOn: {
            selector: '.cornerstone-viewport-element',
            event: 'CORNERSTONE_TOOLS_MOUSE_WHEEL',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'jumpToMeasurement',
          title: 'Jumping to Measurements in the Panel',
          text: 'Click the measurement in the measurement panel to jump to it.',
          attachTo: {
            element: '[data-cy="data-row"]',
            on: 'left-start',
          },
          advanceOn: {
            selector: '[data-cy="data-row"]',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="data-row"]'),
        },
        {
          id: 'changeLayout',
          title: 'Changing Layout',
          text: 'You can change the layout of the viewer using the layout button.',
          attachTo: {
            element: '[data-cy="Layout"]',
            on: 'bottom',
          },
          advanceOn: {
            selector: '[data-cy="Layout"]',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="Layout"]'),
        },
        {
          id: 'selectLayout',
          title: 'Selecting the MPR Layout',
          text: 'Select the MPR layout to view the images in MPR mode.',
          attachTo: {
            element: '[data-cy="MPR"]',
            on: 'left-start',
          },
          advanceOn: {
            selector: '[data-cy="MPR"]',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="MPR"]'),
        },
      ],
      tourOptions: {
        useModalOverlay: true,
        defaultStepOptions: {
          buttons: [
            {
              text: 'Skip all',
              action() {
                this.complete();
              },
              secondary: true,
            },
          ],
        },
      },
    },
    {
      id: 'userStudyTour',
      route: '/user-study-mode',
      steps: [
        {
          id: 'welcome',
          title: 'Introduction',
          text: 'The interface is divided into three panels. Click next to learn about each.',
          attachTo: {
            element: '.viewport-element',
            on: 'top',
          },
          advanceOn: {
            selector: '.viewport-element',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('.viewport-element'),
        },
        {
          id: 'leftPanel',
          title: 'Patient Vignette',
          text: "This panel contains information about the patient. The patient vignette is for the current patient's chest CT scan in the viewer.",
          attachTo: {
            element: '[data-cy="study-question-component"]',
            on: 'right',
          },
          advanceOn: {
            selector: 'body',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="study-question-component"]'),
        },
        {
          id: 'patientCtBadge',
          title: 'Patient CT Scan',
          text: 'This badge indicates that you are viewing the original patient CT scan (not an AI-generated CT scan).',
          attachTo: {
            element: '[data-cy="origin-label-patient"]',
            on: 'left',
          },
          beforeShowPromise: () => waitForElement('[data-cy="origin-label-patient"]'),
        },
        {
          id: 'displayOptions',
          title: 'Display Options',
          text: 'Use window/level presets (such as Soft tissue, Lung, Bone, etc.) from the display options menu to quickly apply common viewing settings. You can also simply drag your mouse over the CT scan to adjust the window/level to your preferred settings. ',
          attachTo: {
            element: '[data-cy="window-level-menu-trigger"]',
            on: 'left',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="window-level-menu-trigger"]').then(() => {
              const trigger = document.querySelector('[data-cy="window-level-menu-trigger"]');
              if (trigger && trigger instanceof HTMLElement) {
                trigger.click();
              }
            }),
        },
        {
          id: 'windowPresetsMenu',
          title: 'Window Presets Menu',
          text: 'Open the Window Presets menu to see the available window/level options.',
          attachTo: {
            element: '[data-cy="submenu-window-presets"]',
            on: 'left',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="window-level-menu-trigger"]').then(() => {
              const trigger = document.querySelector('[data-cy="window-level-menu-trigger"]');
              if (trigger && trigger instanceof HTMLElement) {
                trigger.click();
              }
              return waitForElement('[data-cy="submenu-window-presets"]');
            }),
        },
        {
          id: 'windowPresetLung',
          title: 'Window Presets',
          text: 'For example, you can select the Lung preset (1500 / -600) to optimize the view for the lungs.',
          attachTo: {
            element: '[data-cy="window-preset-lung"]',
            on: 'left',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="window-level-menu-trigger"]').then(() => {
              const trigger = document.querySelector('[data-cy="window-level-menu-trigger"]');
              if (trigger && trigger instanceof HTMLElement) {
                trigger.click();
              }
              return waitForElement('[data-cy="submenu-window-presets"]')
                .then(() => {
                  const submenu = document.querySelector('[data-cy="submenu-window-presets"]');
                  if (submenu && submenu instanceof HTMLElement) {
                    submenu.click();
                  }
                })
                .then(() => waitForElement('[data-cy="window-preset-lung"]'));
            }),
        },
        {
          id: 'rightPanel',
          title: 'AI Tools',
          text: 'This panel contains a selection of different AI tools that you will use throughout the study. Click next to view what each AI tool does.',
          attachTo: {
            element: '[data-cy="explanation-component"]',
            on: 'left',
          },
          beforeShowPromise: () => waitForElement('[data-cy="explanation-component"]'),
        },
        {
          id: 'exampleTab',
          title: 'Similar Cases',
          text: 'Use AI to find other patients’ chest CT scans with similar abnormalities to those of your current patient’s chest CT scan.',
          attachTo: {
            element: '[data-cy="explanation-component"]',
            on: 'left',
          },
          beforeShowPromise: () => {
            return waitForElement('[data-cy="nav-button-example"]').then(() => {
              const tab = document.querySelector('[data-cy="nav-button-example"]');
              if (tab && typeof tab.click === 'function') {
                tab.click();
              }
            });
          },
        },
        {
          id: 'generateCtFromSimilar',
          title: 'Generate CT scan',
          text: 'You will click generate CT scan to bring it into the viewport. ',
          attachTo: {
            element: '[data-cy="similar-generate-ct"]',
            on: 'left',
          },
          beforeShowPromise: () => waitForElement('[data-cy="similar-generate-ct"]'),
          when: {
            show: () => {
              const btn = document.querySelector('[data-cy="similar-generate-ct"]');
              if (btn && btn instanceof HTMLElement) {
                btn.click();
              }
            },
          },
        },
        {
          id: 'aiGeneratedBadge',
          title: 'AI-generated scan',
          text: 'This badge indicates that the CT scan was generated using AI.',
          attachTo: {
            element: '[data-cy="origin-label-ai"]',
            on: 'left',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="origin-label-ai"]').then(() => {
              const badges = Array.from(document.querySelectorAll('[data-cy="origin-badge-ai"]'));
              const target = badges.length > 1 ? badges[badges.length - 1] : badges[0];
              if (target) {
                const vid =
                  target.getAttribute('data-viewport-id') ||
                  target.closest('[data-viewport-id]')?.getAttribute('data-viewport-id') ||
                  '';
                const vp =
                  (vid && document.querySelector(`[data-viewport-id="${vid}"]`)) ||
                  target.closest('[data-viewport-id]') ||
                  target.closest('.viewport-element') ||
                  null;
                const canvas =
                  (vp && vp.querySelector('canvas.cornerstone-canvas')) ||
                  (vp && vp.querySelector('.cornerstone-viewport-element')) ||
                  vp;
                canvas?.click?.();
              }
              return new Promise<void>(resolve => {
                window.requestAnimationFrame(() => window.setTimeout(resolve, 50));
              });
            }),
        },
        {
          id: 'imageSliceSync',
          title: 'Image Slice Sync',
          text: 'Use Image Slice Sync to keep slice positions aligned across viewports.',
          attachTo: {
            element: '[data-cy="ImageSliceSync"]',
            on: 'left',
          },
          beforeShowPromise: () =>
            waitForElement('[data-cy="MoreTools-split-button-secondary"]').then(() => {
              const dropdownToggle = document.querySelector(
                '[data-cy="MoreTools-split-button-secondary"]'
              );
              dropdownToggle?.click?.();
              return waitForElement('[data-cy="ImageSliceSync"]');
            }),
        },
        {
          id: 'captureViewport',
          title: 'Capture Image',
          text: 'Use the Capture button in the viewport overlay to copy a snapshot of the current slice to your clipboard for easy copying/pasting.',
          attachTo: {
            element: '[data-cy="viewport-capture"]',
            on: 'left',
          },
          beforeShowPromise: () => waitForElement('[data-cy="viewport-capture"]'),
        },
        {
          id: 'variationTab',
          title: 'Variations',
          text: 'Use AI to see how your patient’s chest CT scan would look by adding, removing, or changing abnormalities.',
          attachTo: {
            element: '[data-cy="explanation-component"]',
            on: 'left',
          },
          beforeShowPromise: () => {
            return waitForElement('[data-cy="nav-button-variation"]').then(() => {
              const tab = document.querySelector('[data-cy="nav-button-variation"]');
              if (tab && typeof tab.click === 'function') {
                tab.click();
              }
            });
          },
        },
        {
          id: 'radiopaediaTab',
          title: 'Important Regions',
          text: 'Use AI to highlight important regions related to the abnormalities in the chest CT scan.',
          attachTo: {
            element: '[data-cy="explanation-component"]',
            on: 'left',
          },
          beforeShowPromise: () => {
            return waitForElement('[data-cy="nav-button-radiopaedia"]').then(() => {
              const tab = document.querySelector('[data-cy="nav-button-radiopaedia"]');
              if (tab && typeof tab.click === 'function') {
                tab.click();
              }
            });
          },
        },
        {
          id: 'openaiTab',
          title: 'Q&A',
          text: 'Use AI to generate a text description of the impression for the currently viewed slice.',
          attachTo: {
            element: '[data-cy="explanation-component"]',
            on: 'left',
          },
          beforeShowPromise: () => {
            return waitForElement('[data-cy="nav-button-assistant"]').then(() => {
              const tab = document.querySelector('[data-cy="nav-button-assistant"]');
              if (tab && typeof tab.click === 'function') {
                tab.click();
              }
            });
          },
        },
      ],
      tourOptions: {
        useModalOverlay: true,
        defaultStepOptions: {
          buttons: [
            {
              text: 'Next',
              action() {
                this.next();
              },
              secondary: true,
            },
          ],
        },
      },
    },
  ],
};

function waitForElement(selector, maxAttempts = 20, interval = 25) {
  return new Promise(resolve => {
    let attempts = 0;

    const checkForElement = setInterval(() => {
      const element = document.querySelector(selector);

      if (element || attempts >= maxAttempts) {
        clearInterval(checkForElement);
        resolve();
      }

      attempts++;
    }, interval);
  });
}
