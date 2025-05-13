import React, { useEffect, useState } from 'react';
import { ActionButtons, InputText, Input, useViewportGrid } from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import { DicomMetadataStore, DisplaySetService } from '@ohif/core'
import WrappedPreviewStudyBrowser from './components/WrappedPreviewStudyBrowser'
import ServerStatus from './components/ServerStatus'
import axios from 'axios';
import dicomParser from 'dicom-parser';
import { metaData } from '@cornerstonejs/core';

function GenerativeAIComponent({ commandsManager, extensionManager, servicesManager }) {
  const { displaySetService, uiModalService, viewportGridService } = servicesManager.services;
  const [promptData, setPromptData] = useState('');
  const [promptHeaderData, setPromptHeaderData] = useState('Generated, X');
  const [modelIsRunning, setModelIsRunning] = useState(false); // if model in generating images in backend
  const [isServerRunning, setIsServerRunning] = useState(false); // if connection to server possible
  const [dataIsUploading, setDataIsUploading] = useState(false); // if data is uploading to orthanc server
  const [oldModelIsRunning, setOldModelIsRunning] = useState(false);
  const [generatingFileSeriesInstanceUID, setGeneratingFileSeriesInstanceUID] = useState('');
  const [generatingFilePrompt, setGeneratingFilePrompt] = useState('');
  const [fileID, setFileID] = useState('');

  const disabled = false;
  // const serverUrl = 'http://149.165.154.176:5000';
  // const serverUrl = 'https://149.165.174.108:5000';
  const serverUrl = 'https://medsyn.katelyncmorrison.com';

  const [{ viewports }] = useViewportGrid();

  // check server status
  useEffect(() => {
    const checkServerStatus = async () => {

      try {
        const response = await axios.get(serverUrl);

        if (response.status === 200) {
          setIsServerRunning(true);
        } else {
          setIsServerRunning(false);
        }
      } catch (error) {

        setIsServerRunning(false);
      }
    };

    checkServerStatus();
    const interval = setInterval(checkServerStatus, 50000); // Check every 50 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);

  // follow status of MedSyn: when finished download images from backend and upload to Orthanc
  useEffect(() => {
    const checkModelIsRunning = async () => {
      try {
        const response = await axios.get(`${serverUrl}/status`);

        if (response.status === 200) {
          const processIsRunning = response.data['process_is_running'];
          setModelIsRunning((prevModelIsRunning) => {
            if (prevModelIsRunning === false && processIsRunning === true) {
              console.log("Model started");
            } else if (prevModelIsRunning === true && processIsRunning === false) {
              console.log("Model ended");
              console.log("Try to download data");

              executeDownloadAndUpload();
            }
            setOldModelIsRunning(prevModelIsRunning);
            return processIsRunning;
          });
        }
      } catch (error) {
        console.log('Error checking for model status:', error);
      }
    };
    const executeDownloadAndUpload = async () => {
      try {
        await _downloadAndUploadImages(fileID);

        await _addMetadataToSeries(generatingFileSeriesInstanceUID, generatingFilePrompt, 'SeriesPrompt');

        // Show success window and wait for user to click OK
        await showSuccessFeedback();

      } catch (error) {
        console.error('Error in downloading and uploading images:', error);
        showErrorFeedback();

      }
    };
    const reloadWindow = () => {

      console.log('Modal is closing');
      window.location.reload();
    };
    const showErrorFeedback = () => {
      uiModalService.show({
        title: 'Error with Image Generation ',
        containerDimensions: 'w-1/2',
        content: () => {
          return (
            <div>
              <p className="mt-2 p-2">
                The backend CUDA may be out of memory. Please try clicking "Generate new CT" again and hope that the backend server has less load this time.
              </p>
            </div>
          );
        },
      });

    }

    const showSuccessFeedback = () => {
      return new Promise((resolve) => {
        uiModalService.show({
          title: 'Info',
          containerDimensions: 'w-1/2',

          content: () => {
            return (
              <div>
                <p className="mt-2 p-2 mb-8">
                  The CT scan was generated successfully
                </p>
                <div className="flex items-center p-2 ml-8">
                  <div className="text-primary-main  mr-2">Name:</div>
                  <div className="text-blue-300  mr-2">{promptHeaderData}</div>
                </div>
                <div className="flex flex-col mb-8 p-2 ml-8">
                  <div className="text-primary-main  mr-2">Prompt:</div>
                  <div className="mr-2">{promptData}</div>
                </div>
                <ActionButtons
                  className="bg-primary-dark"
                  actions={[

                    {
                      label: 'Ok',
                      onClick: reloadPage,
                    },
                  ]}
                  disabled={disabled}
                />

              </div>
            );
          },

        });
      });
    };

    checkModelIsRunning();
    const interval = setInterval(checkModelIsRunning, 5000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [fileID, generatingFileSeriesInstanceUID]);


  // update text of previews
  useEffect(() => {
    // run when component is mounted at least once to avoid empty text when closing and reopening tab
    _handleDisplaySetsChanged();
    // Subscribe to the DISPLAY_SETS_CHANGED event
    const displaySetSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      _handleDisplaySetsChanged
    );

    // Unsubscribe from the event when the component unmounts
    return () => {
      displaySetSubscription.unsubscribe(displaySetSubscription);
    };
  }, []);

  const handleGenerateClick = async () => {

    // get information about the current study
    const activeDisplaySets = displaySetService.getActiveDisplaySets();
    const studyInstanceUIDs = activeDisplaySets.map(set => set.StudyInstanceUID); // e.g. 3.2 (must be the same for all series in the study)
    const studyInstanceUID = studyInstanceUIDs[0];

    const currentStudy = await _getOrthancStudyByID(studyInstanceUID);
    const firstTenLetters = promptData.replace(/[^a-zA-Z]/g, '').slice(0, 10);

    const formattedDate = _generateUniqueTimestamp();
    let currentFileID = `${formattedDate}${firstTenLetters}` // Generate a unique ID e.g. YYYYMMDDHHMMSSCardiomega


    setFileID(currentFileID);


    console.log("fileID", currentFileID)
    const url = `${serverUrl}/files/${currentFileID}`;

    console.log("promptData: ", promptData);

    const payload = {
      'filename': `${currentFileID}.npy`,
      'prompt': promptData || null,
      'description': promptHeaderData,
      'studyInstanceUID': studyInstanceUID,
      'patient_name': currentStudy.PatientMainDicomTags.PatientName,
      'patient_id': currentStudy.PatientMainDicomTags.PatientID,
    };
    const headers = {
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.post(url, payload, { headers });
      console.log('Start model');
      //console.log('response', response)
      setGeneratingFilePrompt(response.data.prompt)
      setGeneratingFileSeriesInstanceUID(response.data.seriesInstanceUID)

    } catch (error) {
      if (error.response && error.response.data && error.response.data['error']) {
        console.log(error.response)
        uiModalService.show({
          title: 'Error with Image Generation ',
          containerDimensions: 'w-1/2',
          content: () => {
            return (
              <div>
                <p className="mt-2 p-2">
                  Please ensure that the Text for Image generation is not empty.
                </p>

                <div className="text-red-600 mt-2 p-2">Error: {error.response.data['error']}</div>
              </div>
            );
          },
        });
      } else {
        console.log('An unexpected error occurred.');
      }

    }

  };

  const handlePromptHeaderChange = (event) => {
    setPromptHeaderData(event.target.value);
  };

  const handlePromptChange = (event) => {
    setPromptData(event.target.value);
  };
  const clearText = (event) => {
    setPromptData('');
  }

  const reloadPage = async (event) => {
    window.location.reload(); // TODO: change this dirty hack

  }

  const _downloadAndUploadImages = async (fileID) => {
    try {
      console.log("downloadAndUploadImages fileID: ", fileID);
      const files = await _getFilesFromFolder(fileID);

      setDataIsUploading(true);

      const uploadPromises = files.map(async (filename) => {
        try {
          const blob = await _fetchDicomFile(fileID, filename);
          if (blob) {
            // Upload the DICOM file to the Orthanc server
            await _uploadDicomToOrthanc(blob);
          }
        } catch (innerError) {
          console.error('Error in processing file:', filename, innerError);
          throw innerError; // Propagate error to stop all uploads
        }
      });

      await Promise.all(uploadPromises); // Wait for all uploads to complete
      setDataIsUploading(false); // Ensure this is called after all files are processed
      console.log('All files are uploaded', dataIsUploading);
    } catch (error) {
      console.error('Error in Downloading dicom images from server:', error);
      setDataIsUploading(false); // Ensure this is called in case of an error
      throw error
    }
  };




  const _getFilesFromFolder = async (foldername) => {
    try {
      const response = await axios.get(`${serverUrl}/files/${foldername}`);
      return response.data;  // Assuming the response is a list of files
    } catch (error) {
      console.error("Error fetching files:", error.response ? error.response.data.error : error.message);
      throw error;  // Rethrow the error to handle it in the calling code if needed
    }
  };
  const _fetchDicomFile = async (foldername, filename) => {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      const response = await axios.post(`${serverUrl}/files/${foldername}/${filename}`, {
        data: 'example'
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      const arrayBuffer = response.data
      const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
      // const patientName = dataSet.string('x00100010'); // Extract the patient's name as an example
      // console.log(`Patient Name: ${patientName}`);
      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
      return blob;


    } catch (error) {
      console.error('There was an error!', error);
      return null;
    }
  };

  const _uploadDicomToOrthanc = async (blob) => {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'example.dcm');

      const orthancResponse = await axios.post('https://orthanc.katelyncmorrison.com/pacs/instances', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });


    } catch (error) {
      console.error('Error uploading DICOM file to Orthanc:', error);
    }
  };

  const _getOrthancStudyByID = async (studyInstanceUID) => {
    try {
      // Parameters to include in the request
      const params = new URLSearchParams({
        expand: 1,
        requestedTags: "StudyInstanceUID"
      });
      const response = await fetch(`https://orthanc.katelyncmorrison.com/pacs/studies?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      // Filter the data to find the study with the given StudyInstanceUID
      const study = data.find(item => item.RequestedTags.StudyInstanceUID === studyInstanceUID);

      if (study) {
        return study;
      } else {
        console.error("No study found with studyInstanceUID: ", studyInstanceUID)
        return null;
      }

    } catch (error) {
      console.error('There has been a problem with _getOrthancStudyByID:', error);
      return null;
    }
  };
  const _getOrthancSeriesByID = async (seriesInstanceUID) => {
    try {
      // Parameters to include in the request
      const params = new URLSearchParams({
        expand: 1,
        requestedTags: "SeriesInstanceUID"
      });


      const response = await fetch(`https://orthanc.katelyncmorrison.com/pacs/series?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();

      // Filter the data to find the study with the given seriesInstanceUID
      const study = data.find(item => item.RequestedTags.SeriesInstanceUID === seriesInstanceUID);


      if (study) {
        return study;
      } else {
        console.error("No series found with no seriesInstanceUID: ", seriesInstanceUID)
        return null;
      }
    } catch (error) {
      // Log any errors that occur during the fetch operation
      console.error('There has been a problem with your fetch operation:', error);
      return null;
    }
  };
  const _addMetadataToSeries = async (seriesInstanceUid, data, type) => {
    if (type !== 'SeriesPrompt') {
      console.log(`Invalid metadata type: ${type}.`);
      return;
    }

    try {

      const generatedSeries = await _getOrthancSeriesByID(seriesInstanceUid);

      const generatedSeriesOrthancID = generatedSeries.ID;

      const url = `https://orthanc.katelyncmorrison.com/pacs/series/${generatedSeriesOrthancID}/metadata/${type}`;
      const headers = {
        'Content-Type': 'text/plain' // Ensure the server expects text/plain content type
      };

      const response = await axios.put(url, data, { headers });

      if (response.status !== 200) {
        console.log(`Response not ok. Status: ${response.status}, Response text: ${response.statusText}`);
        return;
      }
    } catch (error) {
      console.log(`There was a problem with your fetch operation: ${error}`);
      return error
    }
  };
  const _handleDisplaySetsChanged = async (changedDisplaySets) => {
    const activeDisplaySets = displaySetService.getActiveDisplaySets();
    // set initial prompt header to "Generated, NOT_USED_NUMBER"
    const seriesDescriptions = activeDisplaySets.map(set => set.SeriesDescription);
    const seriesDescriptionNumbers = _extractNumbers(seriesDescriptions);
    const maxNumber = Math.max(...seriesDescriptionNumbers);
    setPromptHeaderData(`Generated, ${maxNumber + 1}`)

  };


  return (
    <div className="ohif-scrollbar flex flex-col">
      <div className="flex flex-col justify-center p-4 bg-primary-dark">

        <div className="flex items-center mb-2">
          <div className="text-primary-main  mr-2">Name:</div>
          <input
            id="promptHeader"
            className="bg-transparent break-all text-base text-blue-300"
            type="text"
            value={promptHeaderData}
            onChange={handlePromptHeaderChange}
            disabled={modelIsRunning || dataIsUploading}
          />
        </div>

        <textarea
          rows={6}
          label="Enter prompt:"
          placeholder="Enter Text to generate CT..."
          className="text-white text-[14px] leading-[1.2] border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
          type="text"
          value={promptData}
          onChange={handlePromptChange}
          disabled={modelIsRunning || dataIsUploading}
        >
        </textarea>

        <div className="flex justify-center p-2 pb-8 bg-primary-dark">
          <ActionButtons
            className="bg-primary-dark"
            actions={[
              {
                label: 'Generate new CT',
                onClick: handleGenerateClick,
                disabled: modelIsRunning || !isServerRunning || dataIsUploading
              },
              {
                label: 'Clear',
                onClick: clearText,
              },
            ]}
            disabled={disabled}
          />
        </div>

        <ServerStatus
          modelIsRunning={modelIsRunning}
          dataIsUploading={dataIsUploading}
          isServerRunning={isServerRunning}
          serverUrl={serverUrl}
        />

      </div>

      {/* dif line */}
      <div className="border border-primary-main"> </div>
      <div className="mx-auto w-9/10">
        <WrappedPreviewStudyBrowser
          commandsManager={commandsManager}
          extensionManager={extensionManager}
          servicesManager={servicesManager}
          activatedTabName="ai"
        />
      </div>
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
  function _generateUniqueTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const formattedDate = `${year}${month}${day}${hours}${minutes}${seconds}`;
    return formattedDate;
  }
}


export default GenerativeAIComponent;
