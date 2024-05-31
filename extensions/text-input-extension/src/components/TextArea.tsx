import React,{useState, useEffect} from 'react';
import {ActionButtons, InputText, Input} from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import {DicomMetadataStore, DisplaySetService} from '@ohif/core'
import { Enums, annotation as CornerstoneAnnotation, annotations as CornerstoneAnnotations} from '@cornerstonejs/tools';
import {RectangleROITool, segmentation} from '@cornerstonejs/tools';
import {
    getEnabledElement,
    StackViewport,
    VolumeViewport,
    utilities as csUtils,
    Types as CoreTypes,
    BaseVolumeViewport,
    metaData,
  } from '@cornerstonejs/core';
import getActiveViewportEnabledElement from '../../../cornerstone/src/utils/getActiveViewportEnabledElement';
import * as cornerstoneTools from '@cornerstonejs/tools';
import * as cornerstone from '@cornerstonejs/core';
import RectangleOverlayViewerTool from '../tools/RectangleOverlayViewerTool';


/**
 * This Component allows Text input and provides features to send text to backend§ services
 * Its state is not shared with other components.
 * 
 */


function TextArea({servicesManager, commandsManager}){
    const { measurementService, displaySetService, toolGroupService, segmentationService, viewportGridService} = servicesManager.services;
    const [initialTextData, setInitialTextData] = useState('');
    const [textData, setTextData] = useState('');
    const disabled = false;

    useEffect(() => {
        // Define the event handler function
        const handleDisplaySetsChanged = changedDisplaySets => {
            // get studyUIDs of current display
            const activeDisplaySets = displaySetService.getActiveDisplaySets();
            const studyInstanceUIDs = activeDisplaySets.map(set => set.StudyInstanceUID);
            
            // search for any init_report data
            const reportList = [];
            studyInstanceUIDs.forEach(studyInstanceUid => {
                const studyMetadata = metaData.get('studyMetadata', studyInstanceUid);
                reportList.push(studyMetadata);
            });
            const initialReportElement = reportList.find(result => result && result.hasOwnProperty('initial_report'));
            const initialReportText = initialReportElement?.['initial_report'] ?? '';
            
            setInitialTextData(initialReportText);
        };

        // Subscribe to the DISPLAY_SETS_CHANGED event
        const subscription = displaySetService.subscribe(
            displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
            handleDisplaySetsChanged
        );

        // Unsubscribe from the event when the component unmounts
        return () => {
            subscription.unsubscribe(subscription);
        };
    }, []);

    const handleDoubleClick = () => {
        // Set the textarea value to the placeholder value, iff empty before
        if (!textData.trim()) {
            setTextData(initialTextData);
        }
    };
    const submitText = (event) => {
        console.log(textData);
    }
    const clearText = (event) => {
        setTextData('');
    }
    const handleChange = (event) => {
        setTextData(event.target.value);
    };

    //reload images by reloading webside
    const navigate = useNavigate();
    const reloadPage = () => {
        

    }



    return (
        <div className="bg-primary-dark">
            <div className="flex justify-center p-4">
                <textarea  
                    rows = {6}
                    label="Enter findings:"
                    className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    placeholder={initialTextData}
                    value={textData}
                    onKeyPress={submitText}
                    onChange={handleChange}
                    onDoubleClick={handleDoubleClick}>
            
                </textarea>
            </div>
            <div className="flex justify-center p-4 bg-primary-dark">
                <ActionButtons
                className="bg-primary-dark"
                actions={[
            
                {
                    label: 'Generate Image',
                    onClick: submitText,
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
        </div>
    
    );
}

export default TextArea;