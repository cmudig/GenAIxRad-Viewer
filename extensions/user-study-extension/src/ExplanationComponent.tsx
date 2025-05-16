import React, { useState } from 'react';

import HistoryPanel from './tabs/HistoryPanel';
import MimicPanel from './tabs/MimicPanel';
import VariationPanel from './tabs/VariationPanel';
import ClassificationPanel from './tabs/ClassificationPanel';
import OtherPanel from './tabs/OtherPanel';

const tabComponents = {
  history: HistoryPanel,
  mimic: MimicPanel,
  variation: VariationPanel,
  classification: ClassificationPanel,
  other: OtherPanel,
};

function ExplanationComponent({ commandsManager, extensionManager, servicesManager }) {
  const [selectedLabel, setSelectedLabel] = useState('history');

  const handleNavClick = (label) => {
    setSelectedLabel(label);
  };

  const SelectedPanel = tabComponents[selectedLabel];

  return (
    <div className="ohif-scrollbar flex flex-col">
      <div className="bg-primary-dark flex flex-col justify-center p-4">
        {/* Navigation Buttons */}
        <div className="flex justify-between items-center">
          {Object.keys(tabComponents).map((label, index) => (
            <button
              key={index}
              onClick={() => handleNavClick(label)}
              className={`bg-black hover:bg-primary-main rounded-md p-4 w-15 h-8 flex items-center justify-center transition duration-300 ${
                selectedLabel === label ? 'bg-primary-main' : ''
              }`}
            >
              <img
                src={`/assets/icon_${label}.png`}
                alt={`Icon ${label}`}
                className="w-8 h-8 object-contain"
              />
            </button>
          ))}
        </div>

        {/* Selected Panel Rendered Here */}
        <div className="my-4">
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
