import { useEffect } from 'react';
import { useShepherd } from 'react-shepherd';
import { StepOptions, TourOptions } from 'shepherd.js';
import { useLocation } from 'react-router';
import 'shepherd.js/dist/css/shepherd.css';
import './Onboarding.css';

import { hasTourBeenShown, markTourAsShown, defaultShowHandler, middleware } from './utilities';
import { auth, db } from '../../../../app/src/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const Onboarding = () => {
  const Shepherd = useShepherd();
  const location = useLocation();
  const tours = window.config.tours as Array<{
    id: string;
    route: string;
    tourOptions: TourOptions;
    steps: StepOptions[];
  }>;

  /**
   * Show the tour if it hasn't been shown yet based on the current route.
   * Constructs a tour instance and adds steps to it based on the matching tour.
   */
  useEffect(() => {
    if (!tours) {
      return;
    }

    const matchingTour = tours.find(tour => tour.route === location.pathname);
    if (!matchingTour || hasTourBeenShown(matchingTour.id)) {
      return;
    }

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
    markTourAsShown(matchingTour.id);
    // ADD THE FIREBASE STUFF HERE
    // 1. Define an async function inside the effect
    const saveData = async () => {
      try {
        await addDoc(collection(db, 'radiology-user-study'), {
          participantId: auth.currentUser.uid,
          timestamp: serverTimestamp(),
          tourComplete: true,
        });
        console.log('Document saved!');
      } catch (error) {
        console.error('Error saving document: ', error);
      }
    };

    // 2. Call the function
    saveData();
  }, [Shepherd, tours, location.pathname]);

  return null;
};

export { Onboarding };
