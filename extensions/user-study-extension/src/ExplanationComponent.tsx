import React, { useState } from 'react';

import HistoryPanel from './tabs/HistoryPanel';
import MimicPanel from './tabs/MimicPanel';
import VariationPanel from './tabs/VariationPanel';
import RadiopaediaComponent from './RadiopaediaComponent';
import ExampleComponent from './ExampleComponent';

const tabComponents = {
  history: HistoryPanel,
  mimic: MimicPanel,
  variation: VariationPanel,
  example: ExampleComponent,
  radiopaedia: RadiopaediaComponent,
};

const tabIconExtensions: Record<string, 'png'> = {
  radiopaedia: 'png',
};

function ExplanationComponent({ commandsManager, extensionManager, servicesManager }) {
  const [selectedLabel, setSelectedLabel] = useState('history');

  const handleNavClick = label => {
    console.log(`Navigating to nav-button-${label} panel`);
    setSelectedLabel(label);
  };

  const SelectedPanel = tabComponents[selectedLabel];

  return (
    <div className="ohif-scrollbar flex flex-col" data-cy="explanation-component">
      <div className="bg-primary-dark flex flex-col justify-center p-4">
        {/* Navigation Buttons */}
        <div className="flex items-center justify-between">
          {Object.keys(tabComponents).map((label, index) => (
            <button
              data-cy={`nav-button-${label}`}
              key={index}
              onClick={() => handleNavClick(label)}
              className={`hover:bg-primary-main w-15 flex h-8 items-center justify-center rounded-md bg-black p-4 transition duration-300 ${
                selectedLabel === label ? 'bg-primary-main' : ''
              }`}
            >
              <img
                src={`/assets/icon_${label}.${tabIconExtensions[label] ?? 'png'}`}
                alt={`Icon ${label}`}
                className="h-8 w-8 object-contain"
              />
            </button>
          ))}
        </div>

        {/* Selected Panel Rendered Here */}
        <div className="my-4" data-cy="selected-panel">
          <SelectedPanel
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
          />
        </div>
      </div>
    </div>
  );
}

export default ExplanationComponent;
