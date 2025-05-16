import React from 'react';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';
import ServerStatus from '../../../text-input-extension/src/components/ServerStatus';

const MimicPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div className='my-4'>
    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="mimic-generation"
      title="New Mimic Generation Panel"
    >
      <div className="space-y-2">
        <GenerationOptions
          prompt="Expertise Level"
          options={[ "Simple", "Moderate", "Advanced" ]}
          onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
        />
        <GenerateButtons/>
      </div>
    </DropdownPanel>

    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="mimic-generation"
      title="Assistant Mimic Explainer"
    >
      <div className="flex p-10 items-center justify-center">
        <p className='text-[12px] text-gray-500 italic'>Create a generation above to see an explanation</p>
      </div>
    </DropdownPanel>

      <DropdownPanel
        servicesManager={servicesManager}
        dropdownId="mimic-history"
        title="Mimic Generation History"
      >
      <WrappedPreviewStudyBrowser
        commandsManager={commandsManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        activatedTabName="mimic"
      />
    </DropdownPanel>
  </div>
);

export default MimicPanel;
