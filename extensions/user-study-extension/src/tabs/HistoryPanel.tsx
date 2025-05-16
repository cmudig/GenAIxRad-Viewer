import React from 'react';
import DropdownPanel from '../DropdownPanel';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';

const HistoryPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div>
    <div className="my-4">
      <DropdownPanel
            servicesManager={servicesManager}
            dropdownId="history"
            title="All Generations History"
          >
            <div className="space-y-2">
               <WrappedPreviewStudyBrowser
                commandsManager={commandsManager}
                extensionManager={extensionManager}
                servicesManager={servicesManager}
                activatedTabName="all"
              />
            </div>
        </DropdownPanel>
    </div>
  </div>
);

export default HistoryPanel;
