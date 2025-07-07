import React from 'react';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, Dropdown, GenerateButtons } from '../GenerationOptions';
import WrappedPreviewStudyBrowser from '../../../text-input-extension/src/components/WrappedPreviewStudyBrowser';
import ServerStatus from '../../../text-input-extension/src/components/ServerStatus';
import { useEffect } from 'react';

const MimicPanel = ({ commandsManager, servicesManager, extensionManager }) => {

  const generationOptionsList = [
    { prompt: "Type:", options: ["Benign", "Malignant"] },
    { prompt: "Rarity:", options: ["Common", "Uncommon", "Rare"] },
    { prompt: "Explanation Complexity:", options: [ "Simple", "Moderate", "Advanced" ] },
  ];

  const [resetKey, setResetKey] = React.useState(0);
  const [answers, setAnswers] = React.useState({});
  const [availableMimics, setAvailableMimics] = React.useState([]);

  const handleSelection = (prompt: string, option: string) => {
    console.log(`Selected ${option} for ${prompt}`);
    setAnswers(prevAnswers => ({
      ...prevAnswers,
      [prompt]: option
    }));
  };

  const handleCancelClick = () => {
    setAnswers({});
    setResetKey(prevKey => prevKey + 1);
  };

  useEffect(() => {
    if (Object.keys(answers).length < 3) {
      setAvailableMimics([]);
      return;
    }
    if (answers["Type:"] === "Benign" && answers["Rarity:"] === "Common") {
      setAvailableMimics(["Benign Mimic 1", "Benign Mimic 2"]);
    } else if (answers["Type:"] === "Benign" && answers["Rarity:"] === "Uncommon") {
      setAvailableMimics(["Uncommon Benign Mimic 1", "Uncommon Benign Mimic 2"]);
    } else if (answers["Type:"] === "Benign" && answers["Rarity:"] === "Rare") {
      setAvailableMimics(["Rare Benign Mimic 1", "Rare Benign Mimic 2"]);
    }
    else if (answers["Type:"] === "Malignant" && answers["Rarity:"] === "Common") {
      setAvailableMimics(["Common Malignant Mimic 1", "Common Malignant Mimic 2"]);
    } else if (answers["Type:"] === "Malignant" && answers["Rarity:"] === "Uncommon") {
      setAvailableMimics(["Uncommon Malignant Mimic 1", "Uncommon Malignant Mimic 2"]);
    } else if (answers["Type:"] === "Malignant" && answers["Rarity:"] === "Rare") {
      setAvailableMimics(["Rare Malignant Mimic 1", "Rare Malignant Mimic 2"]);
    }

  }, [answers]);

  const allRequiredAnswered = generationOptionsList
    .every(option => answers.hasOwnProperty(option.prompt)) && answers.hasOwnProperty("Select a mimic:");

  return (
  <div className='my-4'>
    <DropdownPanel
      dropdownId="mimic-generation"
      title="New Mimic Generation Panel"
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

        <Dropdown
          prompt="Select a mimic:"
          options={ availableMimics }
          onOptionSelect={option => handleSelection("Select a mimic:", option)}
        />

        <GenerateButtons
          commandsManager= {commandsManager}
          servicesManager= {servicesManager}
          answerList= {answers}
          tab="mimic"
          handleCancelClick= {() => handleCancelClick()}
          disabled={!allRequiredAnswered}
        />
      </div>
    </DropdownPanel>

    <DropdownPanel
      dropdownId="mimic-generation"
      title="Assistant Mimic Explainer"
    >
      {/* <div className="flex p-10 items-center justify-center"> */}
        {/* <p className='text-[12px] text-gray-500 italic'>Create a generation above to see an explanation</p> */}
      {/* </div> */}
      <div>
        <div>
          <img></img>
          <img></img>
        </div>
        <p>Results of the inference script</p>
      </div>

    </DropdownPanel>

      <DropdownPanel
        dropdownId="mimic-history"
        title="Mimic Generation History"
      >
      <WrappedPreviewStudyBrowser
        commandsManager={commandsManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        activatedTabName="mimic"
      />
    </DropdownPanel>
  </div> );
};

export default MimicPanel;
