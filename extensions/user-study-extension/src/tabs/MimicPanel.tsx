import React from 'react';
import DropdownPanel from '../DropdownPanel';
import GenerationOptions from '../GenerationOptions';
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
      </div>
      {/* <div>
        <ServerStatus
          modelIsRunning={modelIsRunning}
          dataIsUploading={dataIsUploading}
          isServerRunning={isServerRunning}
          serverUrl={serverUrl}
        />
      </div> */}
    </DropdownPanel>

    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="mimic-generation"
      title="Assistant Mimic Explainer"
    >
      <div className="space-y-2">
        <p>Generated Result goes here</p>
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
