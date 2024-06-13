import React,{useEffect, useState} from 'react';
import {ActionButtons, InputText, Input} from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import {DicomMetadataStore, DisplaySetService} from '@ohif/core'
import WrappedPreviewStudyBrowser from './components/WrappedPreviewStudyBrowser'


function GenerativeAIComponent({ commandsManager, extensionManager, servicesManager }) {
    const {displaySetService} = servicesManager.services;
    const [promptData, setPromptData] = useState('');
    const [promptHeaderData, setPromptHeaderData] = useState('Generated, X');
    
    const disabled = false;


    const handlePromptHeaderChange = (event) => {
        setPromptHeaderData(event.target.value);
    };
    const saveReport = (event) => {
        console.log(promptData);
    };
    const handlePromptChange = (event) => {
        setPromptData(event.target.value);
    };
    const clearText = (event) => {
        setPromptData('');
    }

    const reloadPage = (event) => {
        console.log(event)
    }
    const handleDisplaySetsChanged = async (changedDisplaySets) => {
        const activeDisplaySets = displaySetService.getActiveDisplaySets();
        // set initial prompt header to "Generated, NOT_USED_NUMBER"
        const seriesDescriptions = activeDisplaySets.map(set => set.SeriesDescription);
        const seriesDescriptionNumbers = _extractNumbers(seriesDescriptions);
        const maxNumber = Math.max(...seriesDescriptionNumbers);
        setPromptHeaderData(`Generated, ${maxNumber+1}`)

    }; 

    useEffect(() => {
        // run when component is mounted at least once to avoid empty text when closing and reopening tab
        handleDisplaySetsChanged();
        // Subscribe to the DISPLAY_SETS_CHANGED event
        const displaySetSubscription = displaySetService.subscribe(
            displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
            handleDisplaySetsChanged
        );
        
        // Unsubscribe from the event when the component unmounts
        return () => {
            displaySetSubscription.unsubscribe(displaySetSubscription);
        };
    }, []);



    return (
           
        <div className="ohif-scrollbar flex flex-col">
            <div className="flex flex-col justify-center p-4 bg-primary-dark">
                <div className="text-primary-main font-bold mb-1 mt-2">Generate AI Medical Image Examples</div>
                <input
                    className="bg-transparent break-all text-base text-blue-300 mb-2"
                    type="text"
                    value={promptHeaderData}
                    onChange={handlePromptHeaderChange}
                />
                <textarea  
                    rows = {6}
                    label="Enter prompt:"
                    className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    value={promptData}
                    onKeyPress={saveReport}
                    onChange={handlePromptChange}
                    
                >
                </textarea>
            </div>
            <div className="flex justify-center p-4 bg-primary-dark">
                <ActionButtons
                className="bg-primary-dark"
                actions={[
            
                {
                    label: 'Generate new Image',
                    onClick: saveReport,
                },
                {
                    label: 'Clear',
                    onClick: clearText,
                },
                {
                    label: 'Reload',
                    onClick: reloadPage,
                },
                ]}
                disabled={disabled}
                />
            </div>
            <WrappedPreviewStudyBrowser
                commandsManager={commandsManager}
                extensionManager={extensionManager}
                servicesManager={servicesManager}
                activatedTabName="ai"

            />
        </div>
        
        
    );

    // Function to extract numbers from the array
    function _extractNumbers(arr) {
        // Use reduce to accumulate numbers in a single array
        return arr.reduce((acc, str) => {
        // Match all sequences of digits
        const matches = str.match(/\d+/g);
        if (matches) {
            // Convert matched strings to numbers and add to accumulator
            return acc.concat(matches.map(Number));
        }
        return acc;
        }, [0]);
    };
}


export default GenerativeAIComponent;