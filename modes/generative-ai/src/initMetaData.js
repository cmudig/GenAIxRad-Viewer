import {classes} from '@ohif/core';
import studyMetadata from '../../../data/init_metadata.json';
const { MetadataProvider } = classes;


//TODO: add Interface for MetadataHere
// slice: important only for scrollbar

const metaData = [
  {
    "imageId": "wadors:/dicom-web/studies/1/series/1/instances/1.2.3.2/frames/1",
    "slice": 23,
    "elements": [
      {
        "id": "1",
        "type": "Rectangle",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 75,
          "height": 75,
          "color": [120, 0, 0, 0.5]
        }
      }
    ]
  },
  {
    "imageId": "wadors:/dicom-web/studies/1/series/1/instances/1.2.3.33/frames/1",
    "slice": 24,
    "elements": [
      {
        "id": "2",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 100,
          "height": 100,
          "color": [120, 0, 0, 0.5]
        }
      }
    ]
  },
  {
    "imageId": "wadors:/dicom-web/studies/1/series/1/instances/1.2.3.3/frames/1",
    "slice": 25,
    "elements": [
      {
        "id": "3",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 75,
          "height": 75,
          "color": [120, 0, 0, 0.5]
        }
      },
      {
        "id": "4",
        "attributes": {
          "x": 256,
          "y": 256,
          "width": 75,
          "height": 75,
          "color": [0, 0, 120, 0.5]
        }
      }
    ]
  },
  {
    "imageId": "wadors:/dicom-web/studies/1/series/2/instances/1.2.3.2/frames/1",
    "slice": 23,
    "elements": [
      {
        "id": "5",
        "type": "Rectangle",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 75,
          "height": 75,
          "color": [120, 0, 0, 0.5]
        }
      }
    ]
  },
  {
    "imageId": "wadors:/dicom-web/studies/1/series/2/instances/1.2.3.4/frames/1",
    "slice": 0,
    "elements": [
      {
        "id": "6",
        "type": "Rectangle",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 200,
          "height": 200,
          "color": [120, 0, 0, 0.5]
        }
      }
    ]
  },
  {
    "imageId": "wadors:/dicom-web/studies/1/series/2/instances/1.2.3.17/frames/1",
    "slice": 49,
    "elements": [
      {
        "id": "6",
        "type": "Rectangle",
        "attributes": {
          "x": 200,
          "y": 200,
          "width": 200,
          "height": 200,
          "color": [120, 0, 0, 0.5]
        }
      }
    ]
  },
]

function addStudyMetadata(){
  // Iterate studyMetadata and store it in MetadataProvider
  for (const [key, value] of Object.entries(studyMetadata)) {
    MetadataProvider.addCustomMetadata(key, 'studyMetadata', value);
  }
  
}

// group metaData by start of imageId (this corresponsds to same displayed image stack)
function groupMetaData() {
  const groupedData = {};
  for (let i = 0; i < metaData.length; i++) {
    const imageId = metaData[i].imageId;
    const groupId = imageId.split('/instances/')[0];
    if (!groupedData[groupId]) {
      groupedData[groupId] = [];
    }
    groupedData[groupId].push(metaData[i]);
  }
  return groupedData;
}





// store all rectangles per image stack
function addSlices(){
  const groupedMetaData = groupMetaData();
  
  for (let key in groupedMetaData) {
    if (groupedMetaData.hasOwnProperty(key)) {
      MetadataProvider.addCustomMetadata(key, 'ScrollbarElements',groupedMetaData[key]);
    }
  }
};

function addRectangles(){
  for (let i = 0; i < metaData.length; i++) {
    MetadataProvider.addCustomMetadata(metaData[i].imageId, 'Overlay', metaData[i].elements); // 'Overlay' is just a random name that have to be matched when geting the data with metaData.get
    
  };
};
// store all elements of metaData into MetadataProvider, sth. it can be consumed by other parts of the application
function initMetaData() {
  addRectangles();
  addSlices();
  addStudyMetadata();
};
export default initMetaData;