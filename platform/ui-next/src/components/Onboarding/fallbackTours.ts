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
        text: 'The viewer is divided into three panels. Click to explore.',
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
        title: 'Patient Vignette & Questions',
        text: 'Review the patient vignette (top) and the required study questions (bottom). Use next/previous to navigate the questions.',
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
        text: 'This panel contains tools you might find useful in answering the study questions. Use the tab bar at the top of this panel to explore each assistant.',
        attachTo: {
          element: '[data-cy="explanation-component"]',
          on: 'left',
        },
        beforeShowPromise: () => waitForElement('[data-cy="explanation-component"]'),
      },
      {
        id: 'exampleTab',
        title: 'Similar Cases',
        text: 'Review similar cases and compare the active series with prior outputs.',
        attachTo: {
          element: '[data-cy="explanation-component"]',
          on: 'left',
        },
        beforeShowPromise: () => {
          return waitForElement('[data-cy="nav-button-example"]').then(() => {
            const tab = document.querySelector('[data-cy="nav-button-example"]') as HTMLElement;
            tab?.click();
          });
        },
      },
      {
        id: 'variationTab',
        title: 'Variations',
        text: 'Explore variations of the case by changing findings or severity, and access your prior variation outputs.',
        attachTo: {
          element: '[data-cy="explanation-component"]',
          on: 'left',
        },
        beforeShowPromise: () => {
          return waitForElement('[data-cy="nav-button-variation"]').then(() => {
            const tab = document.querySelector('[data-cy="nav-button-variation"]') as HTMLElement;
            tab?.click();
          });
        },
      },
      {
        id: 'radiopaediaTab',
        title: 'Important Regions',
        text: 'View important regions and context for the study to guide your review.',
        attachTo: {
          element: '[data-cy="explanation-component"]',
          on: 'left',
        },
        beforeShowPromise: () => {
          return waitForElement('[data-cy="nav-button-radiopaedia"]').then(() => {
            const tab = document.querySelector('[data-cy="nav-button-radiopaedia"]') as HTMLElement;
            tab?.click();
          });
        },
      },
      {
        id: 'openaiTab',
        title: 'Q&A',
        text: 'Use Q&A to capture the active viewport slice and send it to GPT for an abnormality summary or follow-up questions.',
        attachTo: {
          element: '[data-cy="explanation-component"]',
          on: 'left',
        },
        beforeShowPromise: () => {
          return waitForElement('[data-cy="nav-button-assistant"]').then(() => {
            const tab = document.querySelector('[data-cy="nav-button-assistant"]') as HTMLElement;
            tab?.click();
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
