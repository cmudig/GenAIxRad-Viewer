import React, { useState, useRef } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

// import HistoryPanel from './tabs/HistoryPanel';
// import MimicPanel from './tabs/MimicPanel';
import VariationPanel from './tabs/VariationPanel';
import OverlayComponent from './OverlayComponent';
import ExampleComponent from './ExampleComponent';
import ChatGPTPanel from './tabs/ChatGPTPanel';
import { db } from '../../../platform/app/src/firebase';

const TABS = [
  { id: 'example', label: 'Similar Patients', component: ExampleComponent },
  { id: 'variation', label: 'Variations', component: VariationPanel },
  { id: 'radiopaedia', label: 'Important Regions', component: OverlayComponent },
  { id: 'assistant', label: 'Q&A', component: ChatGPTPanel },
];

function ExplanationComponent({ commandsManager, extensionManager, servicesManager }) {
  const defaultTab = TABS[0];
  const [selectedTabId, setSelectedTabId] = useState(defaultTab.id);

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
        if (!options) {
          return undefined;
        }
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

      const updatedState =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
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

  const resetOnTransition = (from: string, to: string) => {
    const combos = new Set([
      'variation->example',
      'example->variation',
    ]);
    return combos.has(`${from}->${to}`);
  };

  const handleNavClick = (tabId: string) => {
    const tabExists = TABS.some(tab => tab.id === tabId);
    if (!tabExists) {
      console.warn(`ExplanationComponent: unknown tab '${tabId}'`);
      return;
    }
    const viewportGridService =
      servicesManager?.services?.viewportGridService ||
      servicesManager?.services?.ViewportGridService;
    const displaySetService = servicesManager?.services?.displaySetService;
    const state =
      viewportGridService?.getState?.() || viewportGridService?.getViewportGridState?.();
    const activeViewportId = state?.activeViewportId;
    const activeDisplaySetUID =
      activeViewportId &&
      viewportGridService?.getState?.()?.viewports?.get?.(activeViewportId)
        ?.displaySetInstanceUIDs?.[0];
    const activeDisplaySet = activeDisplaySetUID
      ? displaySetService?.getDisplaySetByUID?.(activeDisplaySetUID)
      : null;
    const targetTab = TABS.find(tab => tab.id === tabId);
    addDoc(collection(db, 'explanation-trajectory'), {
      createdAt: serverTimestamp(),
      fromTabId: selectedTabId,
      toTabId: tabId,
      toTabLabel: targetTab?.label ?? null,
      studyInstanceUID: activeDisplaySet?.StudyInstanceUID ?? null,
    }).catch(error => {
      console.warn('ExplanationComponent: failed to log tab click', error);
    });
    console.log(`Navigating to nav-button-${tabId} panel`);
    document.dispatchEvent(
      new CustomEvent('tabChanged', {
        detail: { tab: tabId },
      })
    );
    if (resetOnTransition(selectedTabId, tabId)) {
      handleResetExamples();
    }
    setSelectedTabId(tabId);
  };

  const activeTab = TABS.find(tab => tab.id === selectedTabId) ?? defaultTab;
  const ActivePanel = activeTab.component;

  return (
    <div className="ohif-scrollbar flex h-full flex-col" data-cy="explanation-component">
      <div className="bg-primary-dark flex min-h-0 flex-1 flex-col p-4">
        {/* <div className="mb-3 text-center">
          <p className="text-white/70 text-xs uppercase tracking-[0.2em]">AI Tools</p>
        </div> */}

        <div className="grid grid-cols-2 gap-3">
          {TABS.map(tab => {
            const isActive = tab.id === selectedTabId;
            return (
              <button
                data-cy={`nav-button-${tab.id}`}
                key={tab.id}
                onClick={() => handleNavClick(tab.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition duration-200 ${
                  isActive
                    ? 'bg-primary-main shadow-primary-main/40 text-black shadow-lg'
                    : 'bg-black/70 text-white/80 hover:bg-black'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Selected Panel Rendered Here */}
        <div className="my-4 min-h-0 flex-1" data-cy="selected-panel">
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
