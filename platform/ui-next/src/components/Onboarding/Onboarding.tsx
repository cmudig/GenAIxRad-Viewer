import { useEffect } from 'react';
import { useShepherd } from 'react-shepherd';
import { StepOptions, TourOptions } from 'shepherd.js';
import { useLocation } from 'react-router';
import 'shepherd.js/dist/css/shepherd.css';
import './Onboarding.css';

import { defaultShowHandler, middleware } from './utilities';
import { fallbackTours } from './fallbackTours';
import { isDemoRoute } from '../../../../app/src/utils/demoRoute';

const Onboarding = () => {
  const Shepherd = useShepherd();
  const location = useLocation();
  const tours = (window.config?.tours || fallbackTours) as Array<{
    id: string;
    route: string;
    tourOptions: TourOptions;
    steps: StepOptions[];
  }>;

  useEffect(() => {
    if (!tours) {
      console.warn('Onboarding: no tours found in window.config');
      return;
    }

    if (isDemoRoute(location.pathname, location.search)) {
      console.info('Onboarding: skipping tour for demo route');
      return;
    }

    const searchParams = new URLSearchParams(location.search);
    const forcedTourId = searchParams.get('runTour');
    const forceTour = searchParams.get('forceTour') === '1';

    const forcedTour = forcedTourId ? tours.find(tour => tour.id === forcedTourId) : undefined;

    const routeMatchedTour = tours
      .filter(tour => tour.route && location.pathname.startsWith(tour.route))
      .sort((a, b) => b.route.length - a.route.length)[0];

    const wildcardTour = tours.find(tour => !tour.route || tour.route === '*');

    const matchingTour = forcedTour || routeMatchedTour || wildcardTour;

    if (!matchingTour) {
      console.info('Onboarding: no matching tour for path', location.pathname);
      return;
    }

    console.info('Onboarding: starting tour', matchingTour.id, 'for path', location.pathname, {
      forcedTourId,
      forceTour,
    });

    const tourInstance = new Shepherd.Tour({
      ...matchingTour.tourOptions,
      defaultStepOptions: {
        ...matchingTour.tourOptions?.defaultStepOptions,
        floatingUIOptions: matchingTour.tourOptions?.defaultStepOptions?.floatingUIOptions || {
          middleware,
        },
        when: {
          ...matchingTour.tourOptions?.defaultStepOptions?.when,
          show:
            matchingTour.tourOptions?.defaultStepOptions?.when?.show ||
            (() => defaultShowHandler(Shepherd)),
        },
      },
    });
    matchingTour.steps.forEach(step => tourInstance.addStep(step));
    tourInstance.start();
  }, [Shepherd, tours, location.pathname, location.search]);

  return null;
};

export { Onboarding };
