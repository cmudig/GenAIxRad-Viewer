import React from 'react';
import DropdownPanel from '../DropdownPanel';
import { GenerationOptions, Dropdown, GenerateButtons } from '../GenerationOptions';

const ClassificationPanel = ({ commandsManager, servicesManager, extensionManager }) => (
  <div className="my-4">
    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="classification"
      title="Classify Pathologies"
    >
      <p className='flex p-4 items-center justify-center text-[12px] text-aqua-pale italic'>Select pathologies to classify in the generated CT scan</p>

      <Dropdown
        prompt="Generation"
        options={[ "Input", "With", "All", "Generations" ]}
        onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
      />

      <GenerationOptions
        prompt="Pathology to Classify"
        options={[ "Pleural effusion", "Consoldiation" ]}
        onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
      />

      <GenerateButtons/>

       <div className='h-[1px] my-6 mx-4 bg-primary-active rounded rounded-md'></div>
       {/* <ClassifcationResults/> */}
    </DropdownPanel>

    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="segment"
      title="Segment Pathologies"
    >
      <p className='flex p-4 items-center justify-center text-[12px] text-aqua-pale italic'>Outline a pathology is the selected CT scan</p>
      <Dropdown
        prompt="Generation"
        options={[ "Input", "With", "All", "Generations" ]}
        onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
      />
    </DropdownPanel>

    <DropdownPanel
      servicesManager={servicesManager}
      dropdownId="impression"
      title="Generate Impression"
    >
      <p className='flex p-4 items-center justify-center text-[12px] text-aqua-pale italic'>Select a generation to create an impression</p>
      <Dropdown
        prompt="Generation"
        options={[ "Input", "With", "All", "Generations" ]}
        onOptionSelect={(option) => console.log(`Selected option: ${option}`)}
      />

      <GenerateButtons/>

       <div className='h-[1px] my-6 mx-4 bg-primary-active rounded rounded-md'></div>
       {/* <ImpressionResults/> */}
    </DropdownPanel>




  </div>
);

export default ClassificationPanel;
