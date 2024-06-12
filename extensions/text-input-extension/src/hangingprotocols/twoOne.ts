const twoOneProtocol: Types.HangingProtocol.Protocol = {
    /**
     * Default is 2x1 and if there is less then one series to show then it is 1x1
     * 
     */
    id: 'twoOneGenAI',
    description: '2x1 grid layout',
    name: '2x1',
    protocolMatchingRules: [
      {
        id: 'OneOrMoreSeries',
        weight: 25,
        attribute: 'numberOfDisplaySetsWithImages',
        constraint: {
          greaterThan: 0,
        },
      },
    ],
    toolGroupIds: ['default'],
    displaySetSelectors: {
      defaultDisplaySetId: {
        seriesMatchingRules: [
          {
            attribute: 'numImageFrames',
            constraint: {
              greaterThan: { value: 0 },
            },
            required: true,
          },
          {
            attribute: 'isDisplaySetFromUrl',
            weight: 10,
            constraint: {
              equals: true,
            },
          },
        ],
      },
    },
    defaultViewport: {
      viewportOptions: {
        viewportType: 'stack',
        toolGroupId: 'default',
        allowUnmatchedView: true,
      },
      displaySets: [
        {
          id: 'defaultDisplaySetId',
          matchedDisplaySetsIndex: -1,
        },
      ],
    },
    stages: [
      // 2x1 stage
      {
        id: '2x1',
        stageActivation: {
          enabled: {
            minViewportsMatched: 2,
          },
        },
        viewportStructure: {
          layoutType: 'grid',
          properties: {
            rows: 1,
            columns: 2,
          },
        },
        viewports: [
          {
            viewportOptions: {
              toolGroupId: 'default',
              allowUnmatchedView: true,
            },
            displaySets: [
              {
                id: 'defaultDisplaySetId',
              },
            ],
          },
          {
            viewportOptions: {
              toolGroupId: 'default',
              allowUnmatchedView: true,
            },
            displaySets: [
              {
                matchedDisplaySetsIndex: 1,
                id: 'defaultDisplaySetId',
              },
            ],
          },
        ],
      },
    // 1x1 stage
    {
      id: '1x1', // Identifier for the 1x1 stage
      requiredViewports: 1,
      preferredViewports: 1,
      stageActivation: {
        enabled: {
          minViewportsMatched: 1, // Activate if at least 1 viewport is matched
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1, // 1x1 grid layout
        },
      },
      viewports: [
        {
          viewportOptions: {
            toolGroupId: 'default',
            allowUnmatchedView: true,
          },
          displaySets: [
            {
              id: 'defaultDisplaySetId',
            },
          ],
        },
      ],
    },
    ],
    numberOfPriorsReferenced: -1,
  };

export default twoOneProtocol;