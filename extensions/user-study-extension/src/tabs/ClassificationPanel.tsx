import React from 'react';
import { Toolbox } from '@ohif/ui-next';

const ClassificationPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div className="my-4">
    <Toolbox
      commandsManager={commandsManager}
      servicesManager={servicesManager}
      extensionManager={extensionManager}
      buttonSectionId="ClassificationToolbox"
      title="Classification"
    />
  </div>
);

export default ClassificationPanel;
