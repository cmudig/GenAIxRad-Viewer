import React, { useState,useRef } from 'react';

// import HistoryPanel from './tabs/HistoryPanel';
// import MimicPanel from './tabs/MimicPanel';
import VariationPanel from './tabs/VariationPanel';
import RadiopaediaComponent from './RadiopaediaComponent';
import ExampleComponent from './ExampleComponent';
import ChatGPTPanel from './tabs/ChatGPTPanel';

const OpenAIIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    className="h-8 w-8"
    role="img"
    aria-label="OpenAI"
  >
    <circle cx="32" cy="32" r="30" fill="#111827" />
    <path
      fill="#74AA9C"
      d="M45.6 16.5c-.5-8-6.9-14.5-14.9-15C26 1.2 21.8 3.1 18.6 6.3 11.9 5 5.4 8.8 3.3 15.3 1.8 20.2 3.1 25.4 6.6 28.9 2.1 30.4.7 36.6 3 41.9c1.9 4.3 6 7.2 10.5 7.5.5 8 6.9 14.5 15 15 4.8.2 9.1-1.6 12.3-4.8 6.7 1.4 13.1-2.4 15.2-8.9 1.6-4.9.3-10.1-3.2-13.6 4.4-1.4 7.6-5.2 8.7-10.1 1-4.9-.9-9.9-4.8-12.8-1.9-4.3-6-7.2-10.6-7.5ZM32 13.4c1.4 0 2.7.3 3.8.8l3.1 1.6 3.3-1.1c2.3-.8 4.8.4 5.6 2.7.4 1.2.3 2.5-.2 3.6l-1.3 3.2 1.7 3c1.2 2 1 4.6-.6 6.4a5.5 5.5 0 0 1-3.4 1.8l-3.5.5-2.2 2.8c-1.5 1.8-3.9 2.5-6.2 1.8a5.8 5.8 0 0 1-3.2-2.4l-1.9-3-3.6-.6c-2.4-.4-4.3-2.2-4.7-4.6-.2-1.3 0-2.6.6-3.7l1.6-3.1-1.5-3.1c-1.1-2.2-.4-4.8 1.7-6.1 1-.6 2.2-.9 3.4-.8l3.4.6 2.4-2.7A6 6 0 0 1 32 13.4Zm0 6.2a12.4 12.4 0 1 0 .1 24.8 12.4 12.4 0 0 0-.1-24.8Z"
    />
  </svg>
);

const tabComponents = {
  // history: HistoryPanel,
  // mimic: MimicPanel,
  variation: VariationPanel,
  example: ExampleComponent,
  radiopaedia: RadiopaediaComponent,
  assistant: ChatGPTPanel,
};

const tabIconExtensions: Record<string, 'png'> = {
  radiopaedia: 'png',
};

const customIcons: Record<string, React.ReactNode> = {
  assistant: <OpenAIIcon />,
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
              {customIcons[label] ?? (
                <img
                  src={`/assets/icon_${label}.${tabIconExtensions[label] ?? 'png'}`}
                  alt={`Icon ${label}`}
                  className="h-8 w-8 object-contain"
                />
              )}
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
