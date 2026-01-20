import { StepOptions, TourOptions } from 'shepherd.js';

export const fallbackTours: Array<{
  id: string;
  route?: string;
  tourOptions: TourOptions;
  steps: StepOptions[];
}> = [];
