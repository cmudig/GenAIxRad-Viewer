import React, { useState, CSSProperties } from 'react';

interface GenerationOptionsProps {
  prompt: string;
  options: string[];
  onOptionSelect?: (selectedOption: string) => void; // Optional callback for when an option is selected
}

const GenerationOptions: React.FC<GenerationOptionsProps> = ({
  prompt,
  options,
  onOptionSelect,
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(() => null);

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    if (onOptionSelect) {
      onOptionSelect(option); // Call the callback function if provided
    }
  };

  const getOptionButtonStyle = (option: string): CSSProperties => {
    const isSelected = selectedOption === option;
    return {
      padding: '6px 12px',
      border: 'none',
      borderRight: options.indexOf(option) < options.length - 1 ? '1px solid #2B166B' : 'none', // Add right border to all but the last
      cursor: 'pointer',
      backgroundColor: isSelected ? '#0944B3' : '#090C29',
      color: 'white',
      fontSize: '11px',
      outline: 'none',
      transition: 'background-color 0.2s ease',
    };
  };

  return (
    <div className="flex items-center font-medium mb-2 justify-between">
      <span className="mr-2 text-[12px] text-aqua-pale font-semibold font-medium flex items-center">
        {prompt}
      </span>
      <div className="flex border border-secondary-main rounded-md overflow-hidden">
        {options.map((option, index) => (
          <button
            key={index}
            onClick={() => handleOptionClick(option)}
            style={getOptionButtonStyle(option)}
            className={`${selectedOption === option ? 'selected' : ''}`}
            aria-pressed={selectedOption === option}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};

const Dropdown: React.FC<GenerationOptionsProps> = ({
  prompt,
  options,
  onOptionSelect,
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(() => null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedOption(e.target.value);
    if (onOptionSelect) {
      onOptionSelect(e.target.value);
    }
  };

  return (
    <div className="flex items-center mb-2">
      <span className="mr-2 text-[12px] text-aqua-pale font-semibold flex items-center">
        {prompt}
      </span>
      <select
        value={selectedOption ?? ''}
        onChange={handleChange}
        className="appearance-none border border-secondary-main rounded-md px-2 py-1 bg-primary-dark text-white text-[12px]"
      >
        <option value="" disabled>
          Select...
        </option>
        {options.map((option, index) => (
          <option key={index} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};


const GenerateButtons: React.FC = () => (
  <div className='flex mt-4'>
    <button
      key="generate-btn"
      className="mr-4 bg-primary-main text-white rounded shadow text-sm font-semibold py-1 px-4"
      // disabled= {modelIsRunning || !isServerRunning || dataIsUploading}
    >
      Generate
    </button>
    <button key="cancel-btn" className="mr-4 bg-primary-main text-white rounded shadow text-sm font-semibold py-1 px-4">
      Cancel
    </button>
    {/* <ServerStatus
          modelIsRunning={modelIsRunning}
          dataIsUploading={dataIsUploading}
          isServerRunning={isServerRunning}
          serverUrl={serverUrl}
        /> */}
  </div>
);


export { GenerationOptions, Dropdown, GenerateButtons };
