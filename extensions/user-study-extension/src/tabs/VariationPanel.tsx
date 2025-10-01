import React from 'react';
import { useState } from 'react';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';

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
];

const VariationPanel = ({ commandsManager, servicesManager, extensionManager }) => {
  const [gateResetKey, setGateResetKey] = useState(0);
  const [abnormalResetKey, setAbnormalResetKey] = useState(0);

  const [sliderValue, setSliderValue] = useState<number>(2);
  const [answers, setAnswers] = useState<{ [key: string]: any }>({});

  const isAbnormal = answers['Normal / Abnormal'] === 'Abnormal';
  const isNormal = answers['Normal / Abnormal'] === 'Normal';

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setSliderValue(value);
    setAnswers(prev => ({ ...prev, Severity: value }));
  };

  const handleSelection = (prompt: string, option: string) => {
    if (prompt === 'Normal / Abnormal') {
      setAnswers(prev => {
        const next = { ...prev, [prompt]: option };
        if (option === 'Normal') {
          // clear only abnormal fields
          delete next['Location'];
          delete next['Associated Findings'];
          delete next['Severity'];
          setSliderValue(2);
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

  const handleCancelClick = () => {
    setAnswers({});
    setSliderValue(2);
    // ⬇️ fully reset both sides on Cancel
    setGateResetKey(k => k + 1);
    setAbnormalResetKey(k => k + 1);
  };

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
    <div>
      <div className="my-4">
        <DropdownPanel dropdownId="variation-generation" title="Variation Explainer">
          <div className="space-y-2">
            {/* Gate first */}
            <GenerationOptions
              key={gateOption.prompt}
              prompt={gateOption.prompt}
              options={gateOption.options}
              onOptionSelect={opt => handleSelection(gateOption.prompt, opt)}
              resetKey={gateResetKey}
            />

            {/* Only render the rest when Abnormal */}
            {isAbnormal && (
              <>
                {abnormalOptionsList.map(({ prompt, options }) => (
                  <GenerationOptions
                    key={prompt}
                    prompt={prompt}
                    options={options}
                    onOptionSelect={option => handleSelection(prompt, option)}
                    resetKey={abnormalResetKey}
                  />
                ))}

                <div className="flex items-center">
                  <p className="text-aqua-pale mr-2 flex items-center text-[12px] font-semibold font-medium">
                    Severity
                  </p>
                  <div className="w-full flex-col px-2">
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="1"
                      value={sliderValue}
                      onChange={handleSliderChange}
                      className="ml-1 w-full cursor-pointer appearance-none rounded-md"
                      style={
                        {
                          background: `linear-gradient(to right, rgb(90, 204, 230) 0%, rgb(90, 204, 230) ${
                            (100 * (sliderValue - 1)) / 2
                          }%, rgb(58, 63, 153) ${(100 * (sliderValue - 1)) / 2}%, rgb(58, 63, 153) 100%)`,
                          '--thumb-inner-color': '#5acce6',
                          '--thumb-outer-color': '#090c29',
                          height: '3px',
                        } as React.CSSProperties
                      }
                    />
                    <div className="flex w-full justify-between px-2">
                      <div className="flex-1 text-left">
                        <span className="text-sm text-white">Mild</span>
                      </div>
                      <div className="flex-1 text-center">
                        <span className="text-sm text-white">Moderate</span>
                      </div>
                      <div className="flex-1 text-right">
                        <span className="text-sm text-white">Severe</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <GenerateButtons
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            answerList={answers}
            tab="variation"
            handleCancelClick={handleCancelClick}
            disabled={!allRequiredAnswered}
          />
        </DropdownPanel>
      </div>

      <div className="my-4">
        <DropdownPanel dropdownId="variation-history" title="Variations History">
          <WrappedPreviewStudyBrowser
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
            activatedTabName="variation"
          />
        </DropdownPanel>
      </div>
    </div>
  );
};

export default VariationPanel;
