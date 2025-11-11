import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';
import { createPrompt } from '../createPrompt';

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
    options: ['None', 'Pleural thickening', 'Pleural nodularity', 'Atelectasis'],
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

  const initialViewportRef = useRef<null | {
    displaySetInstanceUIDs: string[];
    displaySetOptions?: any;
    viewportOptions?: any;
  }>(null);

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

      const state =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
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

  const cardClass =
    'rounded-xl border border-white/10 bg-[#0b1639] px-3 py-2 text-[13px] text-white/80 shadow-inner shadow-black/40';

  const promptPreview = useMemo(() => {
    if (!Object.keys(answers).length) {
      return '';
    }
    const { text } = createPrompt('variation', answers);
    return (text || '').trim();
  }, [answers]);

  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-3 text-white shadow-lg">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <p className="text-base font-semibold">Variations</p>
          <p className="text-[13px] text-white/80">
            Generate a new image that is the same as the current one except for characteristics you
            select.
          </p>
        </div>
        {/* <div className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
          {isAbnormal ? 'Abnormal flow' : 'Normal flow'}
        </div> */}
      </div>

      <div className="ohif-scrollbar mt-3 flex-1 space-y-3 overflow-y-auto pr-1 text-[13px]">
        <div className={cardClass}>
          <GenerationOptions
            key={`${gateOption.prompt}-${gateResetKey}`}
            prompt={gateOption.prompt}
            options={gateOption.options}
            onOptionSelect={opt => handleSelection(gateOption.prompt, opt)}
            resetKey={gateResetKey}
          />
          <p className="mt-2 text-[11px] text-white/60">
            Choose whether the generated CT scan should be normal or contain abnormalities.
          </p>
        </div>

        {isAbnormal ? (
          <div className="space-y-3">
            {abnormalOptionsList.map(({ prompt, options }) => (
              <div key={`${prompt}-${abnormalResetKey}`} className={cardClass}>
                <GenerationOptions
                  prompt={prompt}
                  options={options}
                  onOptionSelect={option => handleSelection(prompt, option)}
                  resetKey={abnormalResetKey}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-[#091132] p-3 text-[12px] text-white/80 shadow-inner shadow-black/30">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
            <span>Prompt Preview</span>
            <span>{promptPreview ? 'Live view' : 'Waiting for selections'}</span>
          </div>
          <p className="mt-2 whitespace-pre-line text-white/90">
            {promptPreview ||
              'Start filling in the controls above to preview the instructions that will be sent to the AI generator.'}
          </p>
        </div>

        <div className="mt-2 rounded-2xl border border-white/10 bg-gradient-to-r from-[#0b1d4d] to-[#142661] p-3 shadow-inner shadow-black/40">
          <GenerateButtons
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            answerList={answers}
            tab="variation"
            handleCancelClick={handleCancelClick}
            disabled={!allRequiredAnswered}
          />
          <p className="mt-2 text-[11px] text-white/70">
            {allRequiredAnswered
              ? 'Ready to generate a tailored variation.'
              : 'Complete the highlighted selections to enable generation.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VariationPanel;
