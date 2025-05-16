import React from 'react';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';

const generationOptionsList = [
  { prompt: "Severity", options: ["Small", "Moderate", "Large"] },
  { prompt: "Location", options: ["Left", "Bilateral", "Right"] },
  { prompt: "Fluid", options: ["Loculated", "Dependent"] },
  { prompt: "Co-occurence", options: ["Consolidation", "Ground-glass"] },
];


const VariationPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div>
    <div className="my-4">
      <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="variation-generation"
      title="Variation Explainer"
    >
      <div className="space-y-2">
          {generationOptionsList.map(({ prompt, options }, idx) => (
            <GenerationOptions
              key={prompt}
              prompt={prompt}
              options={options}
              onOptionSelect={option => console.log(`Selected option for ${prompt}: ${option}`)}
            />
          ))}
        </div>

      <GenerateButtons/>
    </DropdownPanel>
    </div>
    <div className="my-4">
      <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="variation-history"
      title="Variations History"
    >
      <WrappedPreviewStudyBrowser
        commandsManager={commandsManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        activatedTabName="variation"
      />
    </DropdownPanel>
    </div>

  </div>
);

export default VariationPanel;
