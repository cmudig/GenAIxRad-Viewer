import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  const { viewports } = state;

  if (Array.isArray(viewports)) {
    return viewports;
  }

  if (typeof viewports?.values === 'function') {
    return Array.from(viewports.values());
  }

  if (typeof viewports === 'object') {
    return Object.values(viewports);
  }

  return [];
};

// First gate option comes first
const gateOption = { prompt: 'Normal / Abnormal', options: ['Normal', 'Abnormal'], required: true };

// The rest render only if Abnormal is selected
const abnormalOptionsList = [
  { prompt: 'Location', options: ['Left', 'Bilateral', 'Right'], required: true },
  {
    prompt: 'Associated Findings',
    options: ['Pleural thickening', 'Pleural nodularity', 'Atelectasis'],
    required: false,
  },
  { prompt: 'Severity', options: ['Mild', 'Moderate', 'Severe'], required: true },
];

const VariationPanel = ({
  commandsManager,
  servicesManager,
  extensionManager: _extensionManager,
}) => {
  const [gateResetKey, setGateResetKey] = useState(0);
  const [abnormalResetKey, setAbnormalResetKey] = useState(0);

  const [answers, setAnswers] = useState<{ [key: string]: any }>({});

  const initialViewportRef = useRef<
    | null
    | {
        displaySetInstanceUIDs: string[];
        displaySetOptions?: any;
        viewportOptions?: any;
      }
  >(null);

  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;

  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    const captureInitialViewport = () => {
      if (initialViewportRef.current) {
        return;
      }

      const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(state);
      if (!viewports.length) {
        return;
      }

      const firstViewport = viewports[0];
      if (!firstViewport) {
        return;
      }

      const displaySetInstanceUIDs = firstViewport.displaySetInstanceUIDs || [];
      if (!displaySetInstanceUIDs.length) {
        return;
      }

      const cloneDisplaySetOptions = (options: any) => {
        if (!options) {
          return undefined;
        }
        if (Array.isArray(options)) {
          return options.map(option => ({ ...(option || {}) }));
        }
        if (typeof options === 'object') {
          return { ...options };
        }
        return options;
      };

      initialViewportRef.current = {
        displaySetInstanceUIDs: [...displaySetInstanceUIDs],
        displaySetOptions: cloneDisplaySetOptions(firstViewport.displaySetOptions),
        viewportOptions: { ...(firstViewport.viewportOptions || {}) },
      };
    };

    captureInitialViewport();

    const sub =
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS?.VIEWPORTS_READY || 'event::viewportsReady',
        captureInitialViewport
      ) || null;

    return () => sub?.unsubscribe?.();
  }, [viewportGridService]);

  const restoreInitialViewport = useCallback(async () => {
    if (!viewportGridService) {
      return;
    }

    const initialViewport = initialViewportRef.current;
    if (!initialViewport || !initialViewport.displaySetInstanceUIDs.length) {
      return;
    }

    try {
      const { displaySetInstanceUIDs, displaySetOptions, viewportOptions } = initialViewport;

      const cloneDisplaySetOptions = (options: any) => {
        if (!options) {
          return undefined;
        }
        if (Array.isArray(options)) {
          return options.map(option => ({ ...(option || {}) }));
        }
        if (typeof options === 'object') {
          return { ...options };
        }
        return options;
      };

      const findOrCreateViewport = () => ({
        displaySetInstanceUIDs: [...displaySetInstanceUIDs],
        displaySetOptions: cloneDisplaySetOptions(displaySetOptions),
        viewportOptions: { ...(viewportOptions || {}) },
      });

      await viewportGridService.setLayout({
        numCols: 1,
        numRows: 1,
        findOrCreateViewport,
      });

      const updatedState =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(updatedState);
      const primaryViewport = viewports[0];
      const targetViewportId = primaryViewport?.viewportId;

      if (targetViewportId) {
        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId: targetViewportId,
            displaySetInstanceUIDs: [...displaySetInstanceUIDs],
          },
        ]);

        if (viewportGridService.setActiveViewportId) {
          viewportGridService.setActiveViewportId(targetViewportId);
        }
      }
    } catch (error) {
      console.warn('VariationPanel: Failed to restore initial viewport state', error);
    }
  }, [viewportGridService]);

  const isAbnormal = answers['Normal / Abnormal'] === 'Abnormal';
  const isNormal = answers['Normal / Abnormal'] === 'Normal';

  const handleSelection = (prompt: string, option: string) => {
    if (prompt === 'Normal / Abnormal') {
      setAnswers(prev => {
        const next = { ...prev, [prompt]: option };
        if (option === 'Normal') {
          // clear only abnormal fields
          delete next['Location'];
          delete next['Associated Findings'];
          delete next['Severity'];
          // ⬇️ reset only the abnormal controls,
          // DO NOT touch the gate so its highlight stays
          setAbnormalResetKey(k => k + 1);
        }
        return next;
      });
      return;
    }

    setAnswers(prev => ({ ...prev, [prompt]: option }));
  };

  const handleCancelClick = useCallback(() => {
    setAnswers({});
    // ⬇️ fully reset both sides on Cancel
    setGateResetKey(k => k + 1);
    setAbnormalResetKey(k => k + 1);

    restoreInitialViewport();
  }, [restoreInitialViewport]);

  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab === 'example' || detail?.tab === 'assistant') {
        handleCancelClick();
      }
    };

    document.addEventListener('tabChanged', handleTabChange);
    return () => {
      document.removeEventListener('tabChanged', handleTabChange);
    };
  }, [handleCancelClick]);

  // Button enable rules:
  // - If Normal: only need the gate answered
  // - If Abnormal: all abnormal required fields + Severity must be answered
  const abnormalRequiredOk =
    abnormalOptionsList.filter(o => o.required).every(o => answers.hasOwnProperty(o.prompt)) &&
    answers.hasOwnProperty('Severity');

  const allRequiredAnswered =
    answers.hasOwnProperty('Normal / Abnormal') &&
    ((isNormal && true) || (isAbnormal && abnormalRequiredOk));

  return (
    <div className="border-primary-main flex h-full flex-col rounded-md border p-3">
      <div className="text-primary-light mb-2 text-xs uppercase tracking-wider">
        Variation Generator
      </div>

      <div className="text-[13px] leading-snug text-white">
        <div className="space-y-3">
          <GenerationOptions
            key={`${gateOption.prompt}-${gateResetKey}`}
            prompt={gateOption.prompt}
            options={gateOption.options}
            onOptionSelect={opt => handleSelection(gateOption.prompt, opt)}
            resetKey={gateResetKey}
          />

          {isAbnormal && (
            <div className="space-y-3">
              {abnormalOptionsList.map(({ prompt, options }) => (
                <GenerationOptions
                  key={`${prompt}-${abnormalResetKey}`}
                  prompt={prompt}
                  options={options}
                  onOptionSelect={option => handleSelection(prompt, option)}
                  resetKey={abnormalResetKey}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <GenerateButtons
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            answerList={answers}
            tab="variation"
            handleCancelClick={handleCancelClick}
            disabled={!allRequiredAnswered}
          />
        </div>
      </div>
    </div>
  );
};

export default VariationPanel;
