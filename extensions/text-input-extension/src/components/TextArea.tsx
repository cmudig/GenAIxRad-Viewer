import React,{useState, useEffect} from 'react';
import {ActionButtons, Button, ButtonEnums, InputText, Input, Icon, useViewportGrid} from '@ohif/ui'
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
//import Icon from '../../../../platform/ui/src/components/Icon'


/**
 * This Component allows Text input and provides features to send text to backend§ services
 * Its state is not shared with other components.
 * 
 */


function TextArea({servicesManager, commandsManager}){
    const { measurementService, displaySetService, toolGroupService, segmentationService, viewportGridService, hangingProtocolService} = servicesManager.services;
    const [reportData, setReportData] = useState('');
    const [textData, setTextData] = useState('');

    const [promptData, setPromptData] = useState('');
    const disabled = false;
    const [{viewports }] = useViewportGrid();


    const handleDisplaySetsChanged = changedDisplaySets => {
        console.log("handleDisplaySetsChanged")
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
        
        setReportData(initialReportText);
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


    // change prompt data if certain AI generated image is selected
    useEffect(() => {
        const handleGridStateChanged = changedDisplaySets => {
            // ugly hack since viewport grid updatedes later than GRID_STATE_CHANGED event
            setTimeout(() => {
                
                const viewportState = viewportGridService.getState();
                
                const activeViewportId = viewportGridService.getActiveViewportId();
                
                const activeViewport = viewportState.viewports.get(activeViewportId);

                const activeDisplaySetInstanceUID = activeViewport.displaySetInstanceUIDs[0];
                const activeDisplaySets = displaySetService.getActiveDisplaySets();
                const activeDisplaySet = activeDisplaySets.find(displaySet => displaySet.displaySetInstanceUID === activeDisplaySetInstanceUID);
                const activeSeriesInstanceUID = activeDisplaySet.SeriesInstanceUID;
                const activeSeriesStudyMetadata = metaData.get('studyMetadata', activeSeriesInstanceUID);
                //setPromptData(activeSeriesStudyMetadata?.impressions || ''); // set it to empty string if undefined

            },50)
            
            
        }; 
        
        // Subscribe to the GRID_STATE_CHANGED event
        const activeViewportSubscription = viewportGridService.subscribe(
            viewportGridService.EVENTS.GRID_STATE_CHANGED,
            handleGridStateChanged
        );
        
        // Unsubscribe from the event when the component unmounts
        return () => {
            activeViewportSubscription.unsubscribe(activeViewportSubscription);
        };
    }, []);



    const setPromptDataToReportData = (event) => {
        console.log(reportData);
        setPromptData(reportData);
    }
    const setReportDataToPromptData = (event) => {
        setReportData(promptData);
    }

    const submitText = (event) => {
        console.log(promptData);
    }
    const clearText = (event) => {
        setPromptData('');
    }
    const handleReportChange = (event) => {
        setReportData(event.target.value);
    };
    const handlePromptChange = (event) => {
        setPromptData(event.target.value);
    };

    //reload images by reloading webside
    const navigate = useNavigate();
    const reloadPage = () => {
        //handleDisplaySetsChanged();
        console.log("test")
    }



    return (
        <div className="bg-primary-dark">
            <div className="flex flex-col justify-center p-4">
                <div className="text-primary-main font-bold mb-2">Impressions</div>
                <textarea  
                    rows = {10}
                    label="Enter findings:"
                    className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    value={reportData}
                    onChange={handleReportChange}
                    >
            
                </textarea>
                <div className="flex justify-center p-4 bg-primary-dark">
                    {/* <ActionButtons
                    className="bg-primary-dark mr-4"
                    actions={[
                    {
                        label: 'Save',
                        onClick: submitText,
                    }
                    ]}
                    disabled={disabled}
                    /> */}
                    <Button
                        onClick={setPromptDataToReportData}
                        type={ButtonEnums.type.secondary}
                        size={ButtonEnums.size.small}
                        className="ml-3"
                        >
                        <Icon 
                            name="arrow-right"
                            className="transform rotate-90 h-5 w-5"
                        />
                    </Button>

                </div>
                
            </div>
            <div className="flex flex-col justify-center p-4">
                <div className="text-primary-main font-bold mb-2">Text for Image Generation</div>
                <textarea  
                    rows = {6}
                    label="Enter prompt:"
                    className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    value={promptData}
                    onKeyPress={submitText}
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