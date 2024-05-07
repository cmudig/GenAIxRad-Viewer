import {classes} from '@ohif/core';
const { MetadataProvider } = classes;

//TODO: add Interface for MetadataHere


const metaData = [
  {
    "imageId": "wadors:/dicom-web/studies/1/series/1/instances/1.2.3.2/frames/1",
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
]



// store all elements of metaData into MetadataProvider, sth. it can be consumed by other parts of the application
function initMetaData() {
  for (let i = 0; i < metaData.length; i++) {
    MetadataProvider.addCustomMetadata(metaData[i].imageId, 'Overlay', metaData[i].elements); // 'Overlay' is just a random name that have to be matched when geting the data with metaData.get
    
  };
}


export default initMetaData;