import React from 'react';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, Dropdown, GenerateButtons } from '../GenerationOptions';
import { useEffect } from 'react';
import { getMetadataFromSeries } from 'platform/app/src/components/dicom_helpers';

const ClassificationPanel = ({ commandsManager, servicesManager, extensionManager }) => {
  const [classificationResults, setClassificationResults] = React.useState(null);
  const [impressionResults, setImpressionResults] = React.useState(null);
  const [answers, setAnswers] = React.useState({});
  const [resetKey, setResetKey] = React.useState(0);
  const [allGenerations, setAllGenerations] = React.useState([]);

  const [selectedGeneration1, setSelectedGeneratio1] = React.useState("Select...");
  const [selectedGeneration2, setSelectedGeneration2] = React.useState("Select...");

  const { displaySetService } = servicesManager.services;

  useEffect(() => {
    const currentDisplaySets = displaySetService.activeDisplaySets;
    const descriptions = currentDisplaySets
      .map(ds => ds.seriesDescription || ds.SeriesDescription || "Unknown")
      .filter((desc, idx, arr) => desc && arr.indexOf(desc) === idx);
    setAllGenerations(descriptions);

    // const prompts = await Promise.all(
    //   currentDisplaySets.map(async ds => {
    //     const seriesUID = ds.SeriesInstanceUID;
    //     const seriesPrompt = await getMetadataFromSeries(ds.SeriesInstanceUID, 'SeriesPrompt');
    //   });
    // );
  }, [displaySetService]);


  const handleClassifyClick = () => {
    setClassificationResults("Pleural Effusion with 80% confidence");
  };

  const handleGenerateClick = () => {
    setImpressionResults("''");
  };

  const handleCancelClick = () => { //make sure the reset color works
    setAnswers({});
    setResetKey(prevKey => prevKey + 1);
  };

  const handleDropdownSelection = (prompt, option) => {
    setAnswers(prevAnswers => ({
      ...prevAnswers,
      [prompt]: option
    }));
  };

  return (
    <div className="my-4">
      <DropdownPanel
        servicesManager={servicesManager}
        dropdownId="classification"
        title="Classify Pathologies"
      >
        <p className='flex p-4 items-center justify-center text-[12px] text-aqua-pale italic'>Select pathologies to classify in the generated CT scan</p>

        <Dropdown
          prompt="Generation"
          options={ allGenerations }
          onOptionSelect={option => handleDropdownSelection(prompt, option)}
        />

        <GenerationOptions
          prompt="Pathology to Classify"
          options={[ "Pleural effusion", "Consoldiation" ]}
          onOptionSelect={option => handleDropdownSelection(prompt, option)}
          resetKey={resetKey}
        />

        <div className='flex mt-4'>
          <button
            className= "mr-4 rounded shadow text-sm font-semibold py-1 px-4 bg-primary-main text-white"
            onClick ={handleClassifyClick}
          >
            Classify
          </button>
          <button
            className="mr-4 bg-primary-main text-white rounded shadow text-sm font-semibold py-1 px-4"
            onClick = {handleCancelClick}
          >
            Reset
          </button>
        </div>

        <div className='h-[1px] my-6 bg-primary-active rounded rounded-md'></div>

        {classificationResults != null && (
          <div className='flex items-center'>
            <p className='text-aqua-pale'>AI predicts: <span className='text-white ml-4 text-[12px]'>{classificationResults}</span></p>
          </div>
        )}
      </DropdownPanel>

      <DropdownPanel
        servicesManager={servicesManager}
        dropdownId="impression"
        title="Generate Impression"
      >
        <p className='flex p-4 items-center justify-center text-[12px] text-aqua-pale italic'>Select a generation to create an impression</p>
        <Dropdown
          prompt="Generation"
          options={ allGenerations }
          onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
        />

        <div className='flex mt-4'>
          <button
            className= "mr-4 rounded shadow text-sm font-semibold py-1 px-4 bg-primary-main text-white"
            onClick ={handleGenerateClick}
          >
            Generate
          </button>
          <button
            className="mr-4 bg-primary-main text-white rounded shadow text-sm font-semibold py-1 px-4"
            onClick = {handleCancelClick}
          >
            Cancel
          </button>
        </div>

        <div className='h-[1px] my-6 bg-primary-active rounded rounded-md'></div>

        {impressionResults != null && (
          <div className='flex items-center'>
            <p className='text-aqua-pale'>AI’s Impression of this CT scan is: <span className='text-white ml-4 text-[11px]'>{impressionResults}</span> </p>
          </div>
        )}

      </DropdownPanel>



    </div>
  );
};

export default ClassificationPanel;
