// TODO: move this file in text input extension
import React, { useEffect, useRef, useCallback, useState } from 'react';
import './CustomScrollbar.css';
import {metaData, getEnabledElement, StackViewport} from '@cornerstonejs/core';


const CustomScrollbar = (props) => {
  const {servicesManager, viewportId, element} = props;

  const { cornerstoneViewportService} = servicesManager.services;
  const [content, setContent] = useState([]); //TODO: rename this variable
  const [height, setHeight] = useState(0); 

  
  // subscribe to the viewport data change
  const [viewportData, setViewportData] = useState(null);
  useEffect(() => {
    const { unsubscribe } = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      props => {
        if (props.viewportId !== viewportId) {
          return;
        }

        setViewportData(props.viewportData);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [viewportId]);

  // get viewport information and update the scrollbar
  useEffect(() => {
    if (!viewportData) {
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    console.log("viewport", viewport);
    if (!viewport) {
      return;
    }

    //CustomScrollbar is only implemented for StackViewport
    if (viewport instanceof StackViewport) { 
      // get current image stack id
      const csImageId = viewport.csImage.imageId.split('/instances/')[0];
      
      // recieve metadata of this image stack metadata 
      const metadata = metaData.get('ScrollbarElements', csImageId);
      const sliceIdxs = metadata.map(i => i.slice);
      
      // get number of slices
      const numberOfSlices = viewport.imageIds.length;
      
      // set highlighted to true if the index is in the list of sliceIdxs
      setContent(
        Array.from({ length: numberOfSlices }, (_, i) => ({
          "highlighted": sliceIdxs.includes(i),
        }))
      );
    }

    
    
  }, [viewportId, viewportData]);


  return (
    <div className="custom-scrollbar" >
      {content.map((item, index) => (
        <div
          key={index}
          className="marker"
          style={{
            backgroundColor: item['highlighted']  ? 'rgba(255, 0, 0, 0.5)' : 'transparent',
          }}
        />
      ))}
    </div>
  );
};

export default CustomScrollbar;
