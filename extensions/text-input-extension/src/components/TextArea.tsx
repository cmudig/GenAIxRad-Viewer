import React,{useState} from 'react';
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

    const [textData, setTextData] = useState('');
    const disabled = false;


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
        // test:
        // const studyInstanceUID = '1.2.826.0.1.3680043.8.1055.1.20111102150758591.92402465.76095170';
        // const study = DicomMetadataStore.getStudy(studyInstanceUID);




        // add new measurement

        const identity = (value: any): any => {
            return value;
        };


        
        
        //// get display set
        
        //let toolGroup = toolGroupService.getToolGroup('aiTools');

        //cornerstoneTools.addTool(RectangleOverlayViewerTool);
        // toolGroup.addTool(RectangleOverlayViewerTool.toolName);
        // toolGroup.setToolEnabled();
        //console.log("aiTools: ", toolGroup);

       



        





        // TOD: try draw on canvas

        let measurements;
        let annotations


        ///////////////////////////// creating segmentaiotions WORKS but there is nothing printed
        // let activeTool = toolGroupService.getToolGroup()
        // let activeDisplaySets = displaySetService.getActiveDisplaySets();
        // console.log('Active display sets: ', activeDisplaySets);

        // // create empty segmentation WORKS
        // let promise = commandsManager.runCommand('createEmptySegmentationForViewport', {
        //     viewportId: viewportGridService.getActiveViewportId(),
        //     });     
        


        // // create segmentaion: wee need first an empty segment, and activate it?
        // promise.then(() => {
        //     let activeSegmentations = segmentationService.getSegmentations();
        //     console.log(activeSegmentations);
    
        //     //create a segment
        //     segmentationService.addSegment(activeSegmentations[0].id);

        //     let segmentationID = activeSegmentations[0].id
        //     // add to toolGroup
        //     let toolGroup = segmentationService.getToolGroupIdsWithSegmentation(segmentationID)
        //     console.log(toolGroup);

        //     console.log(toolGroupService.getToolGroup());
        // })
        

        // TODO: continue to modify this Segment
        
        ///////////// New annotation + measurement added but its not visible
        // const source = measurementService.getSource('Cornerstone3DTools', '0.1')

        // const annotationType = 'RectangleROI';

        // let annotation = {
             
        //         uid: '123',
        //         highlighted: false,
        //         isLocked: false,
        //         invalidated: false,
        //         metadata: {
        //           toolName: 'RectangleROI',
        //           FrameOfReferenceUID: '1.2.826.0.1.3680043.8.498.12525174103408688077587597013463673463',
        //           referencedImageId: 'wadors:/dicom-web/studies/1.2.826.0.1.3680043.8.498.81264125008784057147104710635905777368/series/1.2.826.0.1.3680043.8.498.24519978895453765943492274296848377094/instances/1.3.6.1.4.1.14519.5.2.1.6834.5010.104330381878584280497825715897/frames/1',
        //         },
        //         data: {
    
        //           /**
        //            * Don't remove this destructuring of data here.
        //            * This is used to pass annotation specific data forward e.g. contour
        //            */
        //         text: "",
        //         handles: {
        //             points: [
        //                 [-90, -70, 73.50000000000006],
        //                 [103, -70, 73.50000000000006],
        //                 [-90, 20, 73.50000000000006],
        //                 [103, 20, 73.50000000000006],
        //             ],
        //             textBox: {},
                
        //         },
        //         cachedStats: {'imageId:wadors:/dicom-web/studies/1.2.826.0.1.3680043.8.498.81264125008784057147104710635905777368/series/1.2.826.0.1.3680043.8.498.24519978895453765943492274296848377094/instances/1.3.6.1.4.1.14519.5.2.1.6834.5010.104330381878584280497825715897/frames/1':null},
        //         label: "",
    
        //         frameNumber: 7
        //         },
              
             
                  
            
        // };
        // let measurement = {
            
        //     SOPInstanceUID: SOPInstanceUID,
        //     FrameOfReferenceUID: displaySet.instances[0].FrameOfReferenceUID,
        //     referenceSeriesUID: displaySet.SeriesInstanceUID,
        //     label: 'Label',
        //     description: 'Description',
        //     unit: 'mm',
        //     area: 123,
        //     type: measurementService.VALUE_TYPES.POLYLINE,
        //     points: [
        //         [-10, -70, 73.50000000000006],
        //         [50, -70, 73.50000000000006],
        //         [-10, 20, 73.50000000000006],
        //         [50, 20, 73.50000000000006],
        //     ],
        //     source: source,
        //     metadata: {
        //         toolName: 'RectangleROI',
        //         FrameOfReferenceUID: '1.2.826.0.1.3680043.8.498.12525174103408688077587597013463673463',
        //         referencedImageId: 'wadors:/dicom-web/studies/1.2.826.0.1.3680043.8.498.81264125008784057147104710635905777368/series/1.2.826.0.1.3680043.8.498.24519978895453765943492274296848377094/instances/1.3.6.1.4.1.14519.5.2.1.6834.5010.104330381878584280497825715897/frames/1',
        //       },
            
        // };
        
        // let toSourceSchema = () => annotation;
        // let toMeasurement = () => {
        //     if (Object.keys(measurement).includes('invalidProperty')) {
        //       throw new Error('Measurement does not match schema');
        //     }
      
        //     return measurement;
        //   };

        // let matchingCriteria = {
        //     valueType: measurementService.VALUE_TYPES.POLYLINE,
        //     points: 2,
        // };
        // const mapping = measurementService.addMapping(
        //     source,
        //     annotationType,
        //     matchingCriteria,
        //     toSourceSchema,
        //     toMeasurement
        //   );

        //console.log("Succesfully added Mapping");
        // // call add avent
        // let updateCallbackWasCalled = false;
        // const { MEASUREMENT_ADDED } = measurementService.EVENTS;
        // const { unsubscribe } = measurementService.subscribe(
        //     MEASUREMENT_ADDED,
        //     () => (updateCallbackWasCalled = true)
        //   );

        //add annotation
        //const uid = source.annotationToMeasurement(annotationType, annotation);
        //source.annotationToMeasurement(annotationType, { uid, ...measurement });

        

        // measurements = measurementService.getMeasurements();
        // console.log("Measurements: ",measurements);
        // let updatedMeasurement = measurements[0];
        // //modify measurement
        // updatedMeasurement.points[0] = [-90, -70, 73.50000000000006]
        // updatedMeasurement.points[1] = [103, -70, 73.50000000000006]
        // updatedMeasurement.points[2] = [-90, 20, 73.50000000000006]
        // updatedMeasurement.points[3] = [103, 20, 73.50000000000006]
        // updatedMeasurement.uid=sourceCornerstone.uid
        // console.log(updatedMeasurement)
        // let toMeasurement = () => {

        //     return updatedMeasurement;
        // };
        // delete updatedMeasurement.modifiedTimestamp

        // not working
        // const newAnnotationUID = measurementService.addRawMeasurement(
        //     sourceCornerstone,
        //     "RectangleROI",
        //     {updatedMeasurement},
        //     toMeasurement,
            
        //    );
        /////////////////////////////////////////////////////////////////draw annotation working
        // const annotationManager = CornerstoneAnnotation.state.getAnnotationManager();
        // console.log(annotationManager);

        // // update style
        // let defaultToolStyle = CornerstoneAnnotation.config.style.getDefaultToolStyles();
        // console.log(defaultToolStyle);
        // //defaultToolStyle['global']['color']= "rgb(255, 0, 0)";
        // defaultToolStyle['global']['textBoxVisibility']= false;
        // CornerstoneAnnotation.config.style.setDefaultToolStyles(defaultToolStyle);


        // let annotationUID = annotationManager.addAnnotation({ 
        //     uid: '123',
        //     highlighted: false,
        //     isLocked: false,
        //     invalidated: false,
        //     metadata: {
        //       toolName: 'RectangleROI',
        //       FrameOfReferenceUID: '1.2.826.0.1.3680043.8.498.12525174103408688077587597013463673463',
        //       referencedImageId: 'wadors:/dicom-web/studies/1.2.826.0.1.3680043.8.498.81264125008784057147104710635905777368/series/1.2.826.0.1.3680043.8.498.24519978895453765943492274296848377094/instances/1.3.6.1.4.1.14519.5.2.1.6834.5010.104330381878584280497825715897/frames/1',
        //     },
        //     data: {

        //       /**
        //        * Don't remove this destructuring of data here.
        //        * This is used to pass annotation specific data forward e.g. contour
        //        */
        //     text: "Blah blah blah blah blah blah blah blah blah",
        //     handles: {
        //         points: [
        //             [-90, -70, 73.5],
        //             [10, -70, 73.5],
        //             [-90, 20, 73.5],
        //             [10, 20, 73.5],
        //         ],
        //         textBox: {},
            
        //     },
        //     cachedStats: {'imageId:wadors:/dicom-web/studies/1.2.826.0.1.3680043.8.498.81264125008784057147104710635905777368/series/1.2.826.0.1.3680043.8.498.24519978895453765943492274296848377094/instances/1.3.6.1.4.1.14519.5.2.1.6834.5010.104330381878584280497825715897/frames/1':null},
            
        //     },
        //   });

        

        
        // annotations = annotationManager.getAllAnnotations();
        // console.log("All Annotations: ", annotations);


        // ////////////////////////////add measurement
        // const uid = source.annotationToMeasurement(annotationType, annotations[0]);
        // measurements = measurementService.getMeasurements();
        // console.log("Measurements: ",measurements);
        // source.annotationToMeasurement(annotationType, { uid, ...measurements[0] });
        // measurements = measurementService.getMeasurements();
        // console.log("Measurements: ",measurements);
        // ///////////////////////////////////////////
        // //working update:
        // measurements = measurementService.getMeasurements();
        // console.log("Measurements: ",measurements);
        // let updatedMeasurement = measurements[0];
        // //modify measurement
        // updatedMeasurement.points[0] = [-120, -70, 73.50000000000006]
        // updatedMeasurement.points[1] = [10, -70, 73.50000000000006]
        // updatedMeasurement.points[2] = [-120, 20, 73.50000000000006]
        // updatedMeasurement.points[3] = [10, 20, 73.50000000000006]

        // measurementService.update(updatedMeasurement.uid, updatedMeasurement, true);
        ///////////////////////////////////////////


    }



    return (
        <div className="bg-primary-dark">
            <div className="flex justify-center p-4">
                <textarea  
                    rows = {3}
                    label="Enter findings:"
                    className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    value={textData}
                    onKeyPress={submitText}
                    onChange={handleChange}>
            
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