import React, { useEffect, useState, CSSProperties } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  uploadDicomFolder,
  addMetadataToStudy,
} from '../../../platform/app/src/components/dicom_helpers';
import { createPrompt, displaySetIndex } from './createPrompt';
import {
  getMetadataFromSeries,
  addMetadataToSeries,
} from '../../../platform/app/src/components/dicom_helpers';
import { findBestMatchingDisplaySet } from './similarity';

// CURL COMMANDS
// Generation 4 STANDARD FALSE curl -k https://orthanc.katelyncmorrison.com/pacs/series/c8903fa5-bbca061d-8c5f69e7-17a98c10-64355063/metadata/SeriesPromptChanged
// Normal chest with no abnormalities present ENHANCED FALSE curl -k https://orthanc.katelyncmorrison.com/pacs/series/fb9081ba-3f35144c-99df0ec7-ab76349a-0d2d2a34/metadata/SeriesPromptChanged
// Bilateral Moderate 2  curl -k https://orthanc.katelyncmorrison.com/pacs/series/9b8369cc-66f98785-1a4e9b3d-65936dde-c37b6230/metadata/SeriesPromptChanged
// Bilateral moderate 3 curl -k https://orthanc.katelyncmorrison.com/pacs/series/aa77768b-d6e100cb-5caf54c1-4fb657b3-cd476113/metadata/SeriesPromptChanged
//
//curl -X PUT https://orthanc.katelyncmorrison.com/series/97dd52a2-949853d2-78c9964f-f86ee00d-4c059f91/metadata/SeriesPromptChanged      -H "Content-Type: text/plain"      --data "true"
//curl -X PUT https://orthanc.katelyncmorrison.com/studies/8022c382-9a178579-70170824-d040fc0e-12f6f132/metadata/treatmentCondition      -H "Content-Type: text/plain"      --data "enhanced";
//curl -k https://orthanc.katelyncmorrison.com/studies/8022c382-9a178579-70170824-d040fc0e-12f6f132/metadata/treatmentCondition
// https://orthanc.katelyncmorrison.com/studies/8022c382-9a178579-70170824-d040fc0e-12f6f132/metadata/treatmentCondition
//

interface GenerationOptionsProps {
  prompt: string;
  options: string[];
  onOptionSelect?: (selectedOption: string) => void; // Optional callback for when an option is selected
  resetKey?: number;
}

interface GenerateButtonsProps {
  commandsManager: any;
  servicesManager: any;
  answerList: { [key: number]: any };
  tab: string;
  handleCancelClick: () => void;
  disabled: bool;
}

const GenerationOptions: React.FC<GenerationOptionsProps> = ({
  prompt,
  options,
  onOptionSelect,
  resetKey = 0,
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(() => null);

  useEffect(() => {
    setSelectedOption(null);
  }, [resetKey]);

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
    if (onOptionSelect) {
      onOptionSelect(option); // Call the callback function if provided
    }
  };

  const getOptionButtonStyle = (option: string): CSSProperties => {
    const isSelected = selectedOption === option;
    return {
      padding: '6px 12px',
      border: 'none',
      borderRight: options.indexOf(option) < options.length - 1 ? '1px solid #2B166B' : 'none', // Add right border to all but the last
      cursor: 'pointer',
      backgroundColor: isSelected ? '#0944B3' : '#090C29',
      color: 'white',
      fontSize: '11px',
      outline: 'none',
      transition: 'background-color 0.2s ease',
    };
  };

  return (
    <div className="mb-2 flex items-center justify-between font-medium">
      <span className="text-aqua-pale mr-2 flex items-center text-[12px] font-semibold font-medium">
        {prompt}
      </span>
      <div className="border-secondary-main flex overflow-hidden rounded-md border">
        {options.map((option, index) => (
          <button
            key={index}
            onClick={() => handleOptionClick(option)}
            style={getOptionButtonStyle(option)}
            className={`${selectedOption === option ? 'selected' : ''}`}
            aria-pressed={selectedOption === option}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};

const Dropdown: React.FC<GenerationOptionsProps> = ({ prompt, options, onOptionSelect }) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(() => null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedOption(e.target.value);
    if (onOptionSelect) {
      onOptionSelect(e.target.value);
    }
  };

  return (
    <div className="mb-2 flex items-center">
      <span className="text-aqua-pale mr-2 flex items-center text-[12px] font-semibold">
        {prompt}
      </span>
      <select
        value={selectedOption ?? ''}
        onChange={handleChange}
        className="border-secondary-main bg-primary-dark appearance-none rounded-md border px-2 py-1 text-[12px] text-white"
      >
        <option value="" disabled>
          Select...
        </option>
        {options.map((option, index) => (
          <option key={index} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

const GenerateButtons: React.FC<GenerateButtonsProps> = ({
  commandsManager,
  servicesManager,
  answerList,
  tab,
  handleCancelClick,
  disabled,
}) => {
  const [isModelRunning, setIsModelRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oldModelIsRunning, setOldModelIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dataIsUploading, setDataIsUploading] = useState(false);
  const [generateClicked, setGenerateClicked] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingFileSeriesInstanceUID, setGeneratingFileSeriesInstanceUID] = useState('');
  const [generatingFilePrompt, setGeneratingFilePrompt] = useState('');
  const [generatedFileID, setGeneratedFileID] = useState(''); // Store the generated file ID
  const [studyID, setStudyId] = useState('');
  const navigate = useNavigate();
  const manualMode = true;

  const serverUrl =
    window.location.hostname === 'localhost'
      ? 'https://localhost:3443'
      : 'https://medsyn.katelyncmorrison.com'; // Deployed server

  const orthancServerUrl =
    window.location.hostname === 'localhost'
      ? 'http://localhost'
      : 'https://orthanc.katelyncmorrison.com';

  useEffect(() => {
    if (manualMode) {
      return;
    } // Skip the model check since no actual generation
    const checkModelIsRunning = async () => {
      try {
        const response = await axios.get(`${serverUrl}/status`);

        if (response.status === 200) {
          const processIsRunning = response.data['process_is_running'];
          const progressPercentage = response.data['progress'] || 0;
          console.log('CHECK MODEL IS RUNNING: ', response.data);
          setProgress(progressPercentage);
          setIsModelRunning(prevModelIsRunning => {
            if (prevModelIsRunning === false && processIsRunning === true) {
              console.log('Model started');
            } else if (prevModelIsRunning === true && processIsRunning === false) {
              console.log('Model ended');
              console.log('Try to download data');
              console.log('Generated File ID:', generatedFileID);
              executeDownloadAndUpload(studyID);
            }
            setOldModelIsRunning(prevModelIsRunning);
            return processIsRunning;
          });
        }
      } catch (error) {
        console.log('Error checking for model status:', error);
      }
    };
    checkModelIsRunning();
    const interval = setInterval(() => {
      checkModelIsRunning();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [studyID]); // Add generatedFileID as a dependency

  useEffect(() => {
    if (manualMode) {
      return;
    }
    const checkServerStatus = async () => {
      try {
        const response = await axios.get(serverUrl);
        console.log('Server status response:', response.data);
        if (response.data['server_running'] === true) {
          setIsServerRunning(true);
          console.log('Server is running');
        } else {
          setIsServerRunning(false);
        }
      } catch (error) {
        console.error('Error checking server status:', error);
        setIsServerRunning(false);
      }
    };

    checkServerStatus();
    const interval = setInterval(() => {
      checkServerStatus();
    }, 60000); // Check every 60 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);

  useEffect(() => {
    if (manualMode) {
      return;
    }
    const getServerLog = async () => {
      if (isModelRunning) {
        try {
          const response = await axios.get(`${serverUrl}/progress`);
        } catch (error) {
          console.log('Error when getting server log:', error);
        }
      }
    };

    const interval = setInterval(getServerLog, 3000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [isModelRunning]);

  // Minimal helper: log all series for the active study
  async function logAllSeriesForActiveStudy({
    servicesManager,
    getMetadataFromSeries, // optional; used if available
  }: {
    servicesManager: any;
    getMetadataFromSeries?: (sid: string, k: string) => Promise<any>;
  }) {
    const { displaySetService, viewportGridService } = servicesManager.services;

    // Find active display set / study
    const viewportId = viewportGridService.getActiveViewportId();
    const activeDSUID = viewportGridService.getState().viewports.get(viewportId)
      ?.displaySetInstanceUIDs?.[0];

    if (!activeDSUID) {
      console.warn('[Generate] No active display set.');
      return;
    }

    const activeDS = displaySetService.getDisplaySetByUID(activeDSUID);
    if (!activeDS) {
      console.warn('[Generate] Active display set not found.');
      return;
    }

    const studyUID = activeDS.StudyInstanceUID;
    const displaySets = Array.from(displaySetService.getDisplaySetCache().values()).filter(
      ds => ds.StudyInstanceUID === studyUID
    );

    // Build rows for console.table (attempt SeriesPrompt if accessor provided)
    const rows = await Promise.all(
      displaySets.map(async ds => {
        const sid = ds.SeriesInstanceUID;
        let seriesPrompt = '';
        if (getMetadataFromSeries) {
          try {
            seriesPrompt = await getMetadataFromSeries(sid, 'SeriesPrompt');
          } catch {
            /* ignore missing */
          }
        }

        return {
          DisplaySetInstanceUID: ds.displaySetInstanceUID,
          SeriesInstanceUID: sid,
          SeriesNumber: ds.SeriesNumber ?? '',
          SeriesDescription: String(ds.SeriesDescription ?? ''),
          Modality: ds.Modality ?? '',
          NumImages: ds.images?.length ?? ds.numImageFrames ?? ds.NumImageFrames ?? '',
          SeriesPrompt: seriesPrompt || '',
        };
      })
    );

    console.group(`[Generate] Series for StudyInstanceUID: ${studyUID}`);
    console.table(rows);
    console.groupEnd();
  }

  async function getDisplaySets(servicesManager) {
    const { displaySetService, studyBrowserService } = servicesManager.services ?? {};
    // Prefer a direct source of currently loadable display sets:
    if (displaySetService?.getActiveDisplaySets) {
      return displaySetService.getActiveDisplaySets();
    }
    // Fallback: whatever you use in logAllSeriesForActiveStudy()
    const displaySets = await logAllSeriesForActiveStudy({
      servicesManager,
      getMetadataFromSeries,
      // ensure this returns a list of display sets or make your own collector
    });
    return displaySets ?? [];
  }

  let _lastPromptKey = '';
  let _lastTargetUID = '';
  // Trigger model generation and wait until completion
  // --- click handler ---
  const handleGenerateClick = async () => {
    if (isGenerating) {
      setIsGenerating(false);
      setIsLoading(false);
      setGenerateClicked(false);
      return;
    }

    setIsLoading(true);
    setGenerateClicked(true);
    setIsGenerating(true);

    try {
      const { text: promptText, key: promptKey } = createPrompt(tab, answerList);
      if (!promptKey) {
        console.warn('[Generate] Empty prompt — nothing to match.');
        return;
      }

      console.log('[Generate] promptText:', promptText, 'promptKey:', promptKey);

      const displaySets = await getDisplaySets(servicesManager);
      if (!displaySets?.length) {
        console.warn('[Generate] No display sets available.');
        return;
      }

      // Optional context: infer from UI answers if you have them
      const promptContext = {
        modality: answerList?.Modality, // e.g., 'CT', 'MR', 'XR'
        bodyPart: answerList?.['Body Part'] || answerList?.Location,
      };

      const { target, score } = findBestMatchingDisplaySet(displaySets, promptKey, {
        minAcceptScore: 0.42,
        preferUnchanged: true,
        promptContext,
      });

      if (!target) {
        console.warn(
          '[Generate] No series matched prompt (score too low). Leaving viewport unchanged. Score:',
          score.toFixed(3)
        );
        return;
      }

      // Avoid unnecessary switches if we resolved to the same
      if (_lastPromptKey === promptKey && _lastTargetUID === target.displaySetInstanceUID) {
        console.log('[Generate] Same match as last time — no switch.');
      } else {
        const { viewportGridService } = servicesManager.services;
        const viewportId = viewportGridService.getActiveViewportId();

        viewportGridService.setDisplaySetsForViewport({
          viewportId,
          displaySetInstanceUIDs: [target.displaySetInstanceUID],
        });

        // Optionally mark so we can de-prefer it next time if needed
        await addMetadataToSeries(target.SeriesInstanceUID, 'true', 'SeriesPromptChanged');

        window.dispatchEvent(
          new CustomEvent('series-metadata-refresh', {
            detail: { seriesInstanceUID: target.SeriesInstanceUID },
          })
        );

        _lastPromptKey = promptKey;
        _lastTargetUID = target.displaySetInstanceUID;

        console.log('[Generate] Matched series:', {
          score: Number(score.toFixed(3)),
          displaySetInstanceUID: target.displaySetInstanceUID,
          SeriesInstanceUID: target.SeriesInstanceUID,
          SeriesDescription: target.SeriesDescription,
        });
      }
    } catch (error) {
      console.error('Failed to update viewport:', error);
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
    }
  };

  const waitForStudyID = async () => {
    let retries = 20; // Maximum retries
    while (!studyID && retries > 0) {
      console.log('⏳ Waiting for `studyID` to be set...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
      retries--;
    }

    if (!studyID) {
      console.error('❌ Timed out waiting for `studyID` to be set.');
      return;
    }

    console.log('✅ Study ID available:', studyID);

    // 🛠 NEW: Wait for Orthanc to confirm study exists before navigating
    const studyExists = await checkOrthancForStudy(studyID);
    if (studyExists) {
      console.log(`✅ Study ${studyID} found in Orthanc! Navigating...`);
      navigate(`/generative-ai?StudyInstanceUIDs=${studyID}`);
    } else {
      console.error('❌ Study still not available in Orthanc. Navigation aborted.');
    }
  };

  // Function to check if a study exists in Orthanc using `_getOrthancStudyByID`
  const checkOrthancForStudy = async studyInstanceUID => {
    let retries = 20; // Max retries to check if Orthanc has indexed the study
    while (retries > 0) {
      console.log(`🔍 Checking if study ${studyInstanceUID} exists in Orthanc...`);

      const study = await _getOrthancStudyByID(studyInstanceUID);

      if (study) {
        console.log('✅ Study found in Orthanc:', study);
        return true;
      }

      console.warn('⏳ Study not found yet, retrying...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retrying
      retries--;
    }

    console.error(`🚨 Study ${studyInstanceUID} not found after multiple attempts.`);
    return false;
  };

  const _getOrthancStudyByID = async studyInstanceUID => {
    try {
      // Parameters to include in the request
      const params = new URLSearchParams({ expand: 1, requestedTags: 'StudyInstanceUID' });
      const response = await fetch(orthancServerUrl + `/pacs/studies?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      // Filter the data to find the study with the given StudyInstanceUID
      const study = data.find(item => item.RequestedTags.StudyInstanceUID === studyInstanceUID);

      if (study) {
        console.log('We found study: ', study);
        return study;
      } else {
        console.error('No study found with studyInstanceUID: ', studyInstanceUID);
        return null;
      }
    } catch (error) {
      console.error('There has been a problem with _getOrthancStudyByID:', error);
      return null;
    }
  };

  // Function to download and upload images only after model is done generating
  const executeDownloadAndUpload = async generatedfileID => {
    try {
      console.log('Download and upload started for fileID: ', generatedfileID);
      const files = await _getFilesFromFolder(generatedfileID, 0);

      setDataIsUploading(true);

      const uploadPromises = files.map(async filename => {
        try {
          const blob = await _fetchDicomFile(generatedfileID, filename, 0);
          if (blob) {
            await _uploadDicomToOrthanc(blob);
          }
        } catch (innerError) {
          console.error('Error processing file:', filename, innerError);
          throw innerError;
        }
      });

      await Promise.all(uploadPromises); // Wait for all uploads to complete
      setDataIsUploading(false); // After all uploads are finished, set the uploading status to false
      console.log('All files uploaded successfully!');

      // const metadataPromise = await addDummyMetadata(studyID);
      // Ensure studyID is correctly set before navigating
      const response = await addMetadataToStudy(studyID, '', 'Findings');
      console.log('Findings metadata response,', response);
      const response_impressions = await addMetadataToStudy(studyID, '', 'Impressions');
      console.log('Impressions metadata response,', response_impressions);
    } catch (error) {
      console.error('Error in downloading and uploading images:', error);
      setDataIsUploading(false); // Ensure uploading status is updated in case of an error
      throw error;
    } finally {
      console.log('OUR STUDY ID TO NAVIGATE TO IS', studyID);
      waitForStudyID();
    }
  };

  const _getFilesFromFolder = async (foldername, sampleNumber) => {
    try {
      const response = await axios.get(`${serverUrl}/files/${foldername}/${sampleNumber}`);
      console.log('GET FILES RESPONSE:', response.data);
      return response.data; // Assuming the response contains a list of file names
    } catch (error) {
      console.error('Error fetching files:', error);
      throw error;
    }
  };

  const _fetchDicomFile = async (foldername, filename, sampleNumber) => {
    try {
      const response = await axios.post(
        `${serverUrl}/files/${foldername}/${filename}/${sampleNumber}`,
        { data: 'example' },
        { responseType: 'arraybuffer' }
      );

      const arrayBuffer = response.data;
      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
      return blob;
    } catch (error) {
      console.error('Error fetching DICOM file:', error);
      return null;
    }
  };

  const _uploadDicomToOrthanc = async blob => {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'example.dcm');

      const uploadResponse = await axios.post(orthancServerUrl + '/pacs/instances', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      console.log('uploaded successfully', uploadResponse.data);

      const instanceId = uploadResponse.data['ID'];
      if (!instanceId) {
        console.log('Error uploading DICOM file to Orthanc:', uploadResponse.data);
        return;
      }

      const instanceReponse = await axios.get(`${orthancServerUrl}/pacs/instances/${instanceId}`);
      const studyInstanceUid = instanceReponse.data['ParentStudy'];

      console.log(`our study instance UID is: `, studyInstanceUid);

      if (studyInstanceUid) {
        // Step 4: Trigger metadata reconstruction for the study
        await axios.post(`${orthancServerUrl}/pacs/studies/${studyInstanceUid}/reconstruct`);
        console.log(`🔄 Reconstructing metadata for study: ${studyInstanceUid}`);
      } else {
        console.error('Error fetching study instance UID:', instanceReponse.data);
      }
    } catch (error) {
      console.error('Error uploading DICOM file to Orthanc:', error);
    }
  };

  // const _getOrthancStudyId = async (studyInstanceUid, sampleNumber) => {
  //   try {
  //     const response = await axios.get(
  //       `${orthancServerUrl}/pacs/studies?StudyInstanceUID=${studyInstanceUid}/${sampleNumber}`
  //     );
  //     if (response.data && response.data.length > 0) {
  //       return response.data[0].ID; // Assuming the response contains a list with the study ID
  //     } else {
  //       console.log('Study not found.');
  //       return null;
  //     }
  //   } catch (error) {
  //     console.log(`Error fetching study ID: ${error}`);
  //     return null;
  //   }
  // };

  // const _addMetadataToStudy = async (studyInstanceUid, data, type) => {
  //   // Validate the metadata type
  //   if (type !== 'Findings' && type !== 'Impressions') {
  //     console.log(`Invalid metadata type: ${type}. Must be either 'Findings' or 'Impressions'.`);
  //     return;
  //   }

  //   try {
  //     // Step 1: Get the Study ID
  //     const studyId = await _getOrthancStudyId(studyInstanceUid, 0);
  //     if (!studyId) {
  //       console.log(`Study with UID ${studyInstanceUid} not found.`);
  //       return;
  //     }

  //     // Step 2: Prepare the metadata URL
  //     const url = `${orthancServerUrl}/pacs/studies/${studyId}/metadata/${type}`;

  //     // Step 3: Set headers
  //     const headers = {
  //       'Content-Type': 'text/plain', // Ensure text content type
  //     };

  //     // Step 4: Send the PUT request with the data
  //     const response = await axios.put(url, data, { headers });

  //     // Step 5: Check if the request was successful
  //     if (response.status !== 200) {
  //       console.log(
  //         `Failed to add metadata. Status: ${response.status}, Response: ${response.statusText}`
  //       );
  //     } else {
  //       console.log(`Successfully added metadata for ${type}.`);
  //       return response.data;
  //     }
  //   } catch (error) {
  //     console.log(`Error in adding metadata: ${error}`);
  //   }
  // };

  // const generateUniqueTimestamp = () => {
  //   const date = new Date();
  //   const year = date.getFullYear();
  //   const month = String(date.getMonth() + 1).padStart(2, '0');
  //   const day = String(date.getDate()).padStart(2, '0');
  //   const hours = String(date.getHours()).padStart(2, '0');
  //   const minutes = String(date.getMinutes()).padStart(2, '0');
  //   const seconds = String(date.getSeconds()).padStart(2, '0');
  //   return `${year}${month}${day}${hours}${minutes}${seconds}`;
  // };

  // const generateUniqueId = () => {
  //   // return Math.random().toString(11).substr(2, 9);
  //   //generate a random string with 15 numbers - no letters
  //   return Math.floor(Math.random() * 1000000000000000).toString();
  // };

  const styles = {
    statusDot: {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      marginRight: '10px',
      backgroundColor: isServerRunning ? 'green' : 'red',
    },
  };

  return (
    <div className="mt-4 flex">
      <button
        key="generate-btn"
        // className={`mr-4 rounded shadow text-sm font-semibold py-1 px-4
        //   ${isModelRunning || !isServerRunning || dataIsUploading
        //     ? 'bg-secondary-dark text-gray-500'
        //     : 'bg-primary-main text-white'
        //   }`}
        className={`mr-4 rounded py-1 px-4 text-sm font-semibold shadow ${
          disabled ? 'bg-secondary-dark text-gray-500' : 'bg-primary-main text-white'
        }`}
        onClick={handleGenerateClick}
        // disabled= {isModelRunning || !isServerRunning || dataIsUploading}
        disabled={disabled}
      >
        Generate
      </button>
      <button
        key="cancel-btn"
        className="bg-primary-main mr-4 rounded py-1 px-4 text-sm font-semibold text-white shadow"
        onClick={handleCancelClick}
      >
        Reset
      </button>
      <div className="flex items-center">
        <p className="text-aqua-pale p-2">Server status:</p>
        {/* <div style={styles.statusDot}></div> */}
      </div>
    </div>
  );
};

export { GenerationOptions, Dropdown, GenerateButtons };
