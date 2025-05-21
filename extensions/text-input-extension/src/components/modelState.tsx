import React, { createContext, useState, useContext } from 'react';

interface modelStateProps {
  modelIsRunning: boolean;
  isServerRunning: boolean;
  dataIsUploading: boolean;
  serverUrl: string;
  // onGenerateClick: () => void;
  // onClearClick: () => void;
  setModelIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setIsServerRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setDataIsUploading: React.Dispatch<React.SetStateAction<boolean>>;
  setServerUrl: React.Dispatch<React.SetStateAction<string>>;
}

const modelState = createContext<modelStateProps | undefined>(undefined);

export const modelStateProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [modelIsRunning, setModelIsRunning] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [dataIsUploading, setDataIsUploading] = useState(false);
  const [serverUrl, setServerUrl] = useState(''); // Default URL
  // Placeholder handler functions (move your actual ones here or pass setters)
  const handleGenerateClick = () => {
    console.log('Generate clicked from context');
    // Update state as needed
  };

  const clearText = () => {
    console.log('Clear clicked from context');
    // Update state as needed
  };

  const contextValue: modelStateProps = {
    modelIsRunning,
    isServerRunning,
    dataIsUploading,
    serverUrl,
    // onGenerateClick: handleGenerateClick,
    // onClearClick: clearText,
    setModelIsRunning,
    setIsServerRunning,
    setDataIsUploading,
    setServerUrl,
  };

  return <modelState.Provider value={contextValue}>{children}</modelState.Provider>;
};

export const usemodelState = () => {
  const context = useContext(modelState);
  if (!context) {
    throw new Error('usemodelState must be used within an modelStateProvider');
  }
  return context;
};
