import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRenderingEngine } from '@cornerstonejs/core';
import { jumpToSlice } from '@cornerstonejs/core/utilities';
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

type SliceReference = {
  viewportId: string;
  index: number;
  ratio: number | null;
};

const resolveSliceCount = (viewport: any): number | null => {
  if (!viewport) {
    return null;
  }

  const numSlices = viewport.getNumberOfSlices?.();
  if (typeof numSlices === 'number' && numSlices >= 0) {
    return numSlices;
  }

  const imageIds = viewport.getImageIds?.();
  if (Array.isArray(imageIds)) {
    return imageIds.length;
  }

  return null;
};

const captureReferenceSlice = (state: any): SliceReference | null => {
  const viewports = getViewportsArray(state);
  const activeId = state?.activeViewportId ?? viewports[0]?.viewportId ?? null;
  if (!activeId) {
    return null;
  }

  const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
  const viewport = renderingEngine?.getViewport(activeId);
  if (!viewport) {
    return null;
  }

  const currentIndex = viewport.getCurrentImageIdIndex?.();
  if (!Number.isFinite(currentIndex)) {
    return null;
  }

  const sliceCount = resolveSliceCount(viewport);
  const maxIndex = sliceCount && sliceCount > 0 ? sliceCount - 1 : null;
  const clampedIndex =
    maxIndex !== null
      ? Math.min(Math.max(0, currentIndex as number), maxIndex)
      : (currentIndex as number);
  const ratio = maxIndex && maxIndex > 0 ? clampedIndex / maxIndex : null;

  return {
    viewportId: activeId,
    index: clampedIndex,
    ratio,
  };
};

const alignViewportToReferenceSlice = async (
  viewportId: string,
  reference: SliceReference | null
) => {
  if (!reference) {
    return;
  }

  const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
  const viewport = renderingEngine?.getViewport(viewportId);

  if (!viewport || !viewport.element) {
    return;
  }

  const sliceCount = resolveSliceCount(viewport);
  if (!sliceCount || sliceCount < 2) {
    return;
  }

  const maxIndex = sliceCount - 1;
  const targetIndex =
    reference.ratio !== null && reference.ratio !== undefined
      ? Math.round(reference.ratio * maxIndex)
      : Math.min(reference.index, maxIndex);

  if (Number.isFinite(targetIndex)) {
    jumpToSlice(viewport.element, { imageIndex: Math.max(0, Math.min(targetIndex, maxIndex)) });
  }
};

const waitForViewportVolumes = (cornerstoneViewportService: any, viewportId: string) =>
  new Promise<void>(resolve => {
    if (!cornerstoneViewportService) {
      resolve();
      return;
    }

    let resolved = false;
    let timeoutId: number;
    let unsubscribe: (() => void) | undefined;

    const cleanup = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      window.clearTimeout(timeoutId);
      unsubscribe?.();
      resolve();
    };

    timeoutId = window.setTimeout(cleanup, 750);

    const subscription = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS?.VIEWPORT_VOLUMES_CHANGED,
      ({ viewportInfo }: any) => {
        if (viewportInfo?.viewportId === viewportId) {
          cleanup();
        }
      }
    );

    unsubscribe = subscription?.unsubscribe;

    if (!subscription) {
      cleanup();
    }
  });

// First gate option comes first
const gateOption = { prompt: 'Normal / Abnormal', options: ['Normal', 'Abnormal'], required: true };

// The rest render only if Abnormal is selected
const baseAbnormalityOption = {
  prompt: 'Base Abnormality',
  options: ['Pleural effusion', 'Consolidation'],
  required: true,
};

const locationOption = { prompt: 'Location', options: ['Left', 'Bilateral', 'Right'], required: true };
const severityOption = { prompt: 'Severity', options: ['Small', 'Moderate', 'Severe'], required: true };
const pleuralAssociatedFindingsOption = {
  prompt: 'Associated Findings',
  options: ['None', 'Pleural thickening', 'Pleural nodularity', 'Atelectasis', 'Consolidation'],
  required: false,
};
const consolidationAssociatedFindingsOption = {
  prompt: 'Associated Findings',
  options: ['None', 'Pleural effusion', 'Atelectasis'],
  required: false,
};

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
  const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService ?? null;

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

  const restoreInitialViewport = useCallback(
    async (referenceSlice: SliceReference | null = null) => {
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

          await waitForViewportVolumes(cornerstoneViewportService, targetViewportId);
          await alignViewportToReferenceSlice(targetViewportId, referenceSlice);

          if (viewportGridService.setActiveViewportId) {
            viewportGridService.setActiveViewportId(targetViewportId);
          }
        }
      } catch (error) {
        console.warn('VariationPanel: Failed to restore initial viewport state', error);
      }
    },
    [cornerstoneViewportService, viewportGridService]
  );

  const isAbnormal = answers['Normal / Abnormal'] === 'Abnormal';
  const isNormal = answers['Normal / Abnormal'] === 'Normal';
  const baseAbnormality = answers[baseAbnormalityOption.prompt];
  const isPleuralEffusionBase = baseAbnormality === 'Pleural effusion';
  const isConsolidationBase = baseAbnormality === 'Consolidation';

  const handleSelection = (prompt: string, option: string) => {
    if (prompt === 'Normal / Abnormal') {
      setAnswers(prev => {
        const next = { ...prev, [prompt]: option };
        if (option === 'Normal') {
          // clear only abnormal fields
          delete next[baseAbnormalityOption.prompt];
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

    if (prompt === baseAbnormalityOption.prompt) {
      setAnswers(prev => {
        const next = { ...prev, [prompt]: option };
        if (option !== 'Pleural effusion' && option !== 'Consolidation') {
          delete next['Associated Findings'];
        }
        return next;
      });
      return;
    }

    setAnswers(prev => ({ ...prev, [prompt]: option }));
  };

  const handleCancelClick = useCallback(() => {
    const state =
      viewportGridService?.getState?.() || viewportGridService?.getViewportGridState?.();
    const referenceSlice = captureReferenceSlice(state);

    setAnswers({});
    // ⬇️ fully reset both sides on Cancel
    setGateResetKey(k => k + 1);
    setAbnormalResetKey(k => k + 1);

    restoreInitialViewport(referenceSlice);
  }, [restoreInitialViewport, viewportGridService]);

  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab === 'example') {
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
  // - If Abnormal: base abnormality + required fields must be answered
  const abnormalRequiredOk =
    answers.hasOwnProperty(baseAbnormalityOption.prompt) &&
    answers.hasOwnProperty(locationOption.prompt) &&
    answers.hasOwnProperty(severityOption.prompt);

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
            <div key={`${baseAbnormalityOption.prompt}-${abnormalResetKey}`} className={cardClass}>
              <GenerationOptions
                prompt={baseAbnormalityOption.prompt}
                options={baseAbnormalityOption.options}
                onOptionSelect={option => handleSelection(baseAbnormalityOption.prompt, option)}
                resetKey={abnormalResetKey}
              />
            </div>

            <div key={`${locationOption.prompt}-${abnormalResetKey}`} className={cardClass}>
              <GenerationOptions
                prompt={locationOption.prompt}
                options={locationOption.options}
                onOptionSelect={option => handleSelection(locationOption.prompt, option)}
                resetKey={abnormalResetKey}
              />
            </div>

            {isPleuralEffusionBase ? (
              <div
                key={`${pleuralAssociatedFindingsOption.prompt}-${abnormalResetKey}-${baseAbnormality}`}
                className={cardClass}
              >
                <GenerationOptions
                  prompt={pleuralAssociatedFindingsOption.prompt}
                  options={pleuralAssociatedFindingsOption.options}
                  onOptionSelect={option =>
                    handleSelection(pleuralAssociatedFindingsOption.prompt, option)
                  }
                  resetKey={abnormalResetKey}
                />
              </div>
            ) : isConsolidationBase ? (
              <div
                key={`${consolidationAssociatedFindingsOption.prompt}-${abnormalResetKey}-${baseAbnormality}`}
                className={cardClass}
              >
                <GenerationOptions
                  prompt={consolidationAssociatedFindingsOption.prompt}
                  options={consolidationAssociatedFindingsOption.options}
                  onOptionSelect={option =>
                    handleSelection(consolidationAssociatedFindingsOption.prompt, option)
                  }
                  resetKey={abnormalResetKey}
                />
              </div>
            ) : null}

            <div key={`${severityOption.prompt}-${abnormalResetKey}`} className={cardClass}>
              <GenerationOptions
                prompt={severityOption.prompt}
                options={severityOption.options}
                onOptionSelect={option => handleSelection(severityOption.prompt, option)}
                resetKey={abnormalResetKey}
              />
            </div>
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
