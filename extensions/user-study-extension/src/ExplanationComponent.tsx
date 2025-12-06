import React from 'react';
import ChatGPTPanel from './tabs/ChatGPTPanel';

function ExplanationComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="ohif-scrollbar flex h-full flex-col" data-cy="explanation-component">
      <div className="bg-primary-dark flex min-h-0 flex-1 flex-col p-4">
        <div className="my-4 min-h-0 flex-1" data-cy="selected-panel">
          <div className="h-full min-h-0">
            <ChatGPTPanel
              commandsManager={commandsManager}
              servicesManager={servicesManager}
              extensionManager={extensionManager}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExplanationComponent;
