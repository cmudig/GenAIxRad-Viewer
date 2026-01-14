import { StepOptions, TourOptions } from 'shepherd.js';

const waitForElement = (selector: string, maxAttempts = 40, interval = 50) =>
  new Promise<void>(resolve => {
    let attempts = 0;
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el || attempts >= maxAttempts) {
        clearInterval(timer);
        resolve();
      }
      attempts += 1;
    }, interval);
  });

// Minimal fallback tour definitions used when window.config.tours is missing.
// Keep this in sync with platform/app/public/config/default.js:userStudyTour.
export const fallbackTours: Array<{
  id: string;
  route?: string;
  tourOptions: TourOptions;
  steps: StepOptions[];
}> = [
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
        text: 'Use window/level presets (such as Soft tissue, Lung, Bone, etc.) from the display options menu to quickly apply common viewing settings. You can also simply drag your mouse over the CT scan to adjust the window/level to your preferred settings.',
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
        title: 'Similar Patients',
        text: 'Use AI to find other patients’ chest CT scans (with different anatomy) with similar abnormalities to those of your current patient’s chest CT scan.',
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
        text: 'You will click generate CT scan to bring it into the viewport.',
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
        text: 'This badge indicates that the CT scan was generated using AI. Note that this AI cannot generate contrast-enhanced CT scans.',
        attachTo: {
          element: '[data-cy="origin-label-ai"]',
          on: 'left',
        },
        beforeShowPromise: () =>
          waitForElement('[data-cy="origin-label-ai"]').then(() => {
            const badges = Array.from(
              document.querySelectorAll('[data-cy="origin-badge-ai"]')
            ) as HTMLElement[];
            const target = badges.length > 1 ? badges[badges.length - 1] : badges[0];
            if (target) {
              const vid =
                target.getAttribute('data-viewport-id') ||
                target.closest('[data-viewport-id]')?.getAttribute('data-viewport-id') ||
                '';
              const vp =
                (vid && (document.querySelector(`[data-viewport-id="${vid}"]`) as HTMLElement)) ||
                target.closest('[data-viewport-id]') ||
                target.closest('.viewport-element') ||
                null;
              const canvas =
                (vp && (vp.querySelector('canvas.cornerstone-canvas') as HTMLElement)) ||
                (vp && (vp.querySelector('.cornerstone-viewport-element') as HTMLElement)) ||
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
            ) as HTMLElement | null;
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
];
