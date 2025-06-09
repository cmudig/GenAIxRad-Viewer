import React from 'react';
import { useState } from 'react';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, GenerateButtons } from '../GenerationOptions';


const generationOptionsList = [
  { prompt: "Location", options: ["Left", "Bilateral", "Right"] },
  { prompt: "Findings", options: ["Normal", "Abnormal"] },
  { prompt: "Associated Findings", options: ["Pleural thickening", "Pleural nodularity", "Atelectasis"] },
];


const VariationPanel = ({ commandsManager, servicesManager, extensionManager }) => {
  const [resetKey, setResetKey] = useState(0);
  const [sliderValue, setSliderValue] = useState<number>(5);
  const [answers, setAnswers] = useState<{ [key: string]: any }>({});

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
      setSliderValue(value);
        setAnswers(prevAnswers => ({
          ...prevAnswers,
          "Severity": value
      }));
  };

  const handleSelection = (prompt: string, option: string) => {
    setAnswers(prevAnswers => ({
      ...prevAnswers,
      [prompt]: option
    }));
  };

  const handleCancelClick = () => {
    setAnswers({});
    setSliderValue(1);
    setResetKey(prevKey => prevKey + 1);
  };

  return (
  <div>
    <div className="my-4">
      <DropdownPanel
      dropdownId="variation-generation"
      title="Variation Explainer"
    >
      <div className="space-y-2">
          {generationOptionsList.map(({ prompt, options }) => (
            <GenerationOptions
              key={prompt}
              prompt={prompt}
              options={options}
              onOptionSelect={option => handleSelection(prompt, option)}
              resetKey={resetKey}
            />
          ))}
          <div className='flex items-center'>
            <p className='mr-2 text-[12px] text-aqua-pale font-semibold font-medium flex items-center'>Severity</p>
            <div className='flex-col w-full'>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={sliderValue}
                onChange={handleSliderChange}
                className= "w-full appearance-none rounded-md ml-1 cursor-pointer"
                style= {{
                  background: `linear-gradient(to right, rgb(90, 204, 230) 0%, rgb(90, 204, 230) ${(100 * (sliderValue - 1) / 4)}%, rgb(58, 63, 153) ${(100 * (sliderValue - 1) / 4)}%, rgb(58, 63, 153) 100%)`,
                  '--thumb-inner-color': '#5acce6',
                  '--thumb-outer-color': '#090c29',
                  height: '3px',
                } as React.CSSProperties}
              />
              <div className="flex justify-between w-full px-2">
                <span className="text-sm text-white">Mild</span>
                <span className="text-sm text-white">Severe</span>
              </div>
            </div>
          </div>
        </div>

      <GenerateButtons
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        answerList = { answers }
        tab = "variation"
        handleCancelClick = {() => handleCancelClick()}
      />
    </DropdownPanel>
    </div>
    <div className="my-4">
      <DropdownPanel
      dropdownId="variation-history"
      title="Variations History"
    >
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
