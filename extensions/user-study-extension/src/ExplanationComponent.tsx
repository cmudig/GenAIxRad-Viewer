import React, { useState,useRef } from 'react';

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

  const initialViewportRef = useRef<{
    displaySetInstanceUIDs: string[];
    displaySetOptions?: any;
    viewportOptions?: any;
  } | null>(null);

  const handleResetExamples = async () => {
    const viewportGridService =
      servicesManager?.services?.viewportGridService ||
      servicesManager?.services?.ViewportGridService;

    if (!viewportGridService) {
      return;
    }

    // Clear any existing state
    const initialViewport = initialViewportRef.current;
    if (!initialViewport?.displaySetInstanceUIDs?.length) {
      return;
    }

    try {
      const { displaySetInstanceUIDs, displaySetOptions, viewportOptions } = initialViewport;

      const cloneOptions = (options: any) => {
        if (!options) return undefined;
        if (Array.isArray(options)) {
          return options.map(option => ({ ...(option || {}) }));
        }
        return typeof options === 'object' ? { ...options } : options;
      };

      const findOrCreateViewport = () => ({
        displaySetInstanceUIDs: [...displaySetInstanceUIDs],
        displaySetOptions: cloneOptions(displaySetOptions),
        viewportOptions: { ...(viewportOptions || {}) },
      });

      await viewportGridService.setLayout({
        numCols: 1,
        numRows: 1,
        findOrCreateViewport,
      });

      const updatedState = viewportGridService.getState?.() ||
                          viewportGridService.getViewportGridState?.();
      const viewports = Array.from(updatedState?.viewports?.values?.() || []);
      const primaryViewport = viewports[0];

      if (primaryViewport?.viewportId) {
        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId: primaryViewport.viewportId,
            displaySetInstanceUIDs: [...displaySetInstanceUIDs],
          },
        ]);

        viewportGridService.setActiveViewportId?.(primaryViewport.viewportId);
      }


      // Dispatch event to notify components
      document.dispatchEvent(new CustomEvent('examplesReset'));
    } catch (error) {
      console.warn('ExplanationComponent: Failed to restore original viewport state', error);
    }
  };

  const handleNavClick = label => {
    if (!tabComponents[label]) {
      console.warn(`ExplanationComponent: unknown tab '${label}'`);
      return;
    }
    console.log(`Navigating to nav-button-${label} panel`);
    document.dispatchEvent(new CustomEvent('tabChanged', {
      detail: { tab: label }
    }));
    setSelectedLabel(label);
    handleResetExamples();

  };

  const ActivePanel = tabComponents[selectedLabel] ?? tabComponents[defaultTab];
   const activePanelProps = {
    commandsManager,
    servicesManager,
    extensionManager,
    onReset: handleResetExamples,
    initialViewportRef,
  };

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
            <ActivePanel {...activePanelProps} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExplanationComponent;
