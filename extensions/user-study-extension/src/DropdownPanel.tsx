import React, { useState, KeyboardEvent, CSSProperties } from 'react';

interface DropdownPanelProps {
  title: string;
  children: React.ReactNode;
  dropdownId?: string;
  servicesManager?: any; // Placeholder type, replace with actual type if available
  extensionsManager?: any; // Placeholder type, replace with actual type if available
  commandsManager?: any; // Placeholder type, replace with actual type if available
  initialOpen?: boolean; // Optional: set true to be open by default
}

const DropdownPanel: React.FC<DropdownPanelProps> = ({
  title,
  children,
  dropdownId,
  initialOpen = false,
  // Useful props if children components need access to them in the future
  // servicesManager,
  // extensionsManager,
  // commandsManager,
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);

  const toggleOpen = () => {
    setIsOpen(prevIsOpen => !prevIsOpen);
  };

  const contentId = dropdownId ? `${dropdownId}-content` : undefined;

  return (
    <div className="mb-10 bg-primary-dark" id={dropdownId}>
      <div
        className="bg-secondary-dark text-primary-light px-2 p-4 flex justify-between items-center rounded-t-md transition-transform duration-200 bg-secondary-dark hover:bg-accent text-aqua-pale my-0.5 h-7 w-full rounded py-2 pr-1 pl-2.5 "
        onClick={toggleOpen}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <span className='text-[13px] text-aqua-pale font-semibold font-medium'>{title}</span>
        <span className='text-[12px]'>{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div
          className="p-15 dropdown-panel-content"
          id={contentId}
          role="region"
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default DropdownPanel;
