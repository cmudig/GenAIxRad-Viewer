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
