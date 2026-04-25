import {
  RCC,
  RMLO,
  LCC,
  LMLO,
  RCCPrior,
  LCCPrior,
  RMLOPrior,
  LMLOPrior,
} from './mammoDisplaySetSelector';

const leftColumnDisplayArea = {
  storeAsInitialCamera: true,
  imageArea: [0.92, 0.92],
  imageCanvasPoint: {
    imagePoint: [0, 0.5],
    // Shift left-column images further toward the center seam (to the right).
    canvasPoint: [0.2, 0.5],
  },
};

const rightColumnDisplayArea = {
  storeAsInitialCamera: true,
  imageArea: [0.92, 0.92],
  imageCanvasPoint: {
    imagePoint: [1, 0.5],
    // Shift right-column images further toward the center seam (to the left).
    canvasPoint: [0.64, 0.5],
  },
};

const hpMammography = {
  id: '@ohif/hpMammo',
  hasUpdatedPriorsInformation: false,
  name: 'Mammography Breast Screening',
  protocolMatchingRules: [
    {
      id: 'Mammography',
      weight: 150,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: 'MG',
      },
      required: true,
    },
    {
      id: 'numberOfImages',
      attribute: 'numberOfDisplaySetsWithImages',
      constraint: {
        greaterThan: 2,
      },
      required: true,
    },
  ],
  toolGroupIds: ['default'],
  displaySetSelectors: {
    RCC,
    LCC,
    RMLO,
    LMLO,
    RCCPrior,
    LCCPrior,
    RMLOPrior,
    LMLOPrior,
  },

  stages: [
    {
      name: 'CC/MLO',
      viewportStructure: {
        type: 'grid',
        layoutType: 'grid',
        properties: {
          rows: 2,
          columns: 2,
        },
      },
      viewports: [
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: leftColumnDisplayArea,
            allowUnmatchedView: true,
          },
          displaySets: [
            {
              id: 'RMLO',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: rightColumnDisplayArea,
            allowUnmatchedView: true,
          },
          displaySets: [
            {
              id: 'LMLO',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: leftColumnDisplayArea,
            allowUnmatchedView: true,
          },
          displaySets: [
            {
              id: 'RCC',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: rightColumnDisplayArea,
            flipHorizontal: true,
            allowUnmatchedView: true,
          },
          displaySets: [
            {
              id: 'LCC',
            },
          ],
        },
      ],
    },

    // Compare CC current/prior top/bottom
    {
      name: 'CC compare',
      viewportStructure: {
        type: 'grid',
        layoutType: 'grid',
        properties: {
          rows: 2,
          columns: 2,
        },
      },
      viewports: [
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: leftColumnDisplayArea,
            flipHorizontal: true,
            rotation: 180,
          },
          displaySets: [
            {
              id: 'RCC',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            flipHorizontal: true,
            displayArea: rightColumnDisplayArea,
          },
          displaySets: [
            {
              id: 'LCC',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: leftColumnDisplayArea,
            flipHorizontal: true,
          },
          displaySets: [
            {
              id: 'RCCPrior',
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            displayArea: rightColumnDisplayArea,
          },
          displaySets: [
            {
              id: 'LCCPrior',
            },
          ],
        },
      ],
    },
  ],
  // Indicates it is prior aware, but will work with no priors
  numberOfPriorsReferenced: 0,
};

export default hpMammography;
