import React, { useState } from 'react';

// import HistoryPanel from './tabs/HistoryPanel';
// import MimicPanel from './tabs/MimicPanel';
import VariationPanel from './tabs/VariationPanel';
import RadiopaediaComponent from './RadiopaediaComponent';
import ExampleComponent from './ExampleComponent';

const tabComponents = {
  // history: HistoryPanel,
  // mimic: MimicPanel,
  variation: VariationPanel,
  example: ExampleComponent,
  radiopaedia: RadiopaediaComponent,
};

const tabIconExtensions: Record<string, 'png'> = {
  radiopaedia: 'png',
};

function ExplanationComponent({ commandsManager, extensionManager, servicesManager }) {
  const defaultTab = Object.keys(tabComponents)[0];
  const [selectedLabel, setSelectedLabel] = useState(defaultTab);

  const handleNavClick = label => {
    if (!tabComponents[label]) {
      console.warn(`ExplanationComponent: unknown tab '${label}'`);
      return;
    }
    console.log(`Navigating to nav-button-${label} panel`);
    setSelectedLabel(label);
  };

  const ActivePanel = tabComponents[selectedLabel] ?? tabComponents[defaultTab];

  return (
    <div className="ohif-scrollbar flex h-full flex-col" data-cy="explanation-component">
      <div className="bg-primary-dark flex min-h-0 flex-1 flex-col p-4">
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
        <div className="my-4 flex-1 min-h-0" data-cy="selected-panel">
          <div className="h-full min-h-0">
            <ActivePanel
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
