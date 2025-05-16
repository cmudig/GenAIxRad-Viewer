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
    <div className="flex items-center font-medium p-1 justify-between">
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

export default GenerationOptions;
