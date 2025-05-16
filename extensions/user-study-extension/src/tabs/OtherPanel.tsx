import React from 'react';
import { Toolbox } from '@ohif/ui-next';

const OtherPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div className="my-4">
    <Toolbox
      commandsManager={commandsManager}
      servicesManager={servicesManager}
      extensionManager={extensionManager}
      buttonSectionId="OtherToolbox"
      title="Other"
    />
  </div>
);

export default OtherPanel;
