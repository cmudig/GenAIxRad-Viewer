import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { uploadDicomFolder, addMetadataToStudy } from './dicom_helpers';

const serverUrl = 'https://medsyn.katelyncmorrison.com';
const orthancServerUrl = 'https://orthanc.katelyncmorrison.com';

const SearchHomePage = () => {
  const [inputValue, setInputValue] = useState('');
  const [isModelRunning, setIsModelRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [oldModelIsRunning, setOldModelIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dataIsUploading, setDataIsUploading] = useState(false);
  const [generateClicked, setGenerateClicked] = useState(false); // Flag to track if generate button was clicked
  const navigate = useNavigate();

  useEffect(() => {
    const checkModelIsRunning = async () => {
      try {
        const response = await axios.get(`${serverUrl}/status`);

        if (response.status === 200) {
          const processIsRunning = response.data['process_is_running'];
          const progressPercentage = response.data['progress'] || 0;
          setProgress(progressPercentage);
          setIsModelRunning(prevModelIsRunning => {
            if (prevModelIsRunning === false && processIsRunning === true) {
              console.log('Model started');
              setLogs(prevLogs => [...prevLogs, 'Model started']);
            } else if (prevModelIsRunning === true && processIsRunning === false) {
              console.log('Model ended');
              setLogs(prevLogs => [...prevLogs, 'Model ended']);
              console.log('Try to download data');
              setLogs(prevLogs => [...prevLogs, 'Try to download data']);

              executeDownloadAndUpload();
            }
            setOldModelIsRunning(prevModelIsRunning);
            return processIsRunning;
          });
        }
      } catch (error) {
        console.log('Error checking for model status:', error);
        setLogs(prevLogs => [...prevLogs, `Error checking for model status: ${error.message}`]);
      }
    };

    const checkServerStatus = async () => {
      try {
        const response = await axios.get(serverUrl);
        console.log('Server status response:', response.data);
        if (response.status === 200) {
          setIsModelRunning(true);
        } else {
          setIsModelRunning(false);
        }
      } catch (error) {
        console.error('Error checking server status:', error);
        setIsModelRunning(false);
      }
    };

    checkModelIsRunning();
    checkServerStatus();
    const interval = setInterval(() => {
      checkModelIsRunning();
      checkServerStatus();
    }, 60000); // Check every 60 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);

  useEffect(() => {
    const getServerLog = async () => {
      if (isModelRunning) {
        try {
          const response = await axios.get(`${serverUrl}/progress`);
          if (response.status === 200) {
            if (generateClicked) {
              setLogs(prevLogs => [...prevLogs, `Model progress: ${response.data}`]);
            }
          }
        } catch (error) {
          console.log('Error when getting server log:', error);
        }
      }
    };

    const interval = setInterval(getServerLog, 5000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [isModelRunning, generateClicked]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleGenerateClick = async () => {
    setIsLoading(true);
    setGenerateClicked(true); // Set the flag to true when generate button is clicked
    setLogs(['Starting CT scan generation...']);
    try {
      const studyId = generateUniqueId();
      await addMetadataToStudy(
        studyId,
        JSON.stringify({
          StudyInstanceUID: studyId,
          PatientName: 'Generated Patient',
          PatientID: '12345',
          StudyDescription: 'Generated CT Scan',
        }),
        'StudyDescription'
      );
      const response = await generateCTScan(inputValue, studyId);
      if (response.success) {
        setLogs(prevLogs => [...prevLogs, 'CT scan generation in progress...']);
      } else {
        setLogs(prevLogs => [...prevLogs, 'Failed to generate CT scan']);
      }
    } catch (error) {
      setLogs(prevLogs => [...prevLogs, `Error generating CT scan: ${error.message}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const generateCTScan = async (prompt: string, studyId: string) => {
    const formattedDate = generateUniqueTimestamp();
    const firstTenLetters = prompt.replace(/[^a-zA-Z]/g, '').slice(0, 10);
    const fileID = `${formattedDate}${firstTenLetters}`;

    const payload = {
      filename: `${fileID}.npy`,
      prompt: prompt || null,
      description: 'Generated CT Scan',
      studyInstanceUID: studyId,
      patient_name: 'Generated Patient',
      patient_id: '12345',
    };

    const headers = {
      'Content-Type': 'application/json',
    };

    try {
      const response = await axios.post(
        `${serverUrl}/media/volume/gen-ai-volume/MedSyn/results/dicom/${fileID}`,
        payload,
        { headers }
      );
      if (response.status === 200) {
        return { success: true, studyId: payload.studyInstanceUID };
      } else {
        console.error('Error generating CT scan:', response.statusText);
        return { success: false };
      }
    } catch (error) {
      console.error('Error generating CT scan:', error);
      return { success: false };
    }
  };

  const executeDownloadAndUpload = async () => {
    try {
      const studyId = generateUniqueId();
      await downloadAndUploadImages(studyId);
      await addMetadataToStudy(
        studyId,
        JSON.stringify({
          StudyInstanceUID: studyId,
          PatientName: 'Generated Patient',
          PatientID: '12345',
          StudyDescription: 'Generated CT Scan',
        }),
        'StudyDescription'
      ); // Add the study to Orthanc
      await uploadDicomFolder(`/media/volume/gen-ai-volume/MedSyn/results/dicom/${studyId}`); // Upload the DICOM folder
      navigate(`https://genai-radiology.web.app/generative-ai?StudyInstanceUIDs=${studyId}`);
    } catch (error) {
      console.error('Error in executing download and upload:', error);
      setLogs(prevLogs => [
        ...prevLogs,
        `Error in executing download and upload: ${error.message}`,
      ]);
    }
  };

  const downloadAndUploadImages = async (fileID: string) => {
    try {
      console.log('downloadAndUploadImages fileID: ', fileID);
      const files = await getFilesFromFolder(fileID);

      setDataIsUploading(true);

      const uploadPromises = files.map(async filename => {
        try {
          const blob = await fetchDicomFile(fileID, filename);
          if (blob) {
            // Upload the DICOM file to the Orthanc server
            await uploadDicomToOrthanc(blob);
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
      throw error;
    }
  };

  const getFilesFromFolder = async (foldername: string) => {
    try {
      console.log(`Fetching files from folder: ${foldername}`);
      const response = await axios.get(
        `${serverUrl}/media/volume/gen-ai-volume/MedSyn/results/dicom/${foldername}`
      );
      console.log(`Files fetched: ${response.data}`);
      return response.data; // Assuming the response is a list of files
    } catch (error) {
      console.error(
        'Error fetching files:',
        error.response ? error.response.data.error : error.message
      );
      throw error; // Rethrow the error to handle it in the calling code if needed
    }
  };

  const fetchDicomFile = async (foldername: string, filename: string) => {
    try {
      console.log(`Fetching DICOM file: ${foldername}/${filename}`);
      const headers = {
        'Content-Type': 'application/json',
      };
      const response = await axios.post(
        `${serverUrl}/media/volume/gen-ai-volume/MedSyn/results/dicom/${foldername}/${filename}`,
        {
          data: 'example',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      const arrayBuffer = response.data;
      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
      console.log(`DICOM file fetched: ${filename}`);
      return blob;
    } catch (error) {
      console.error('There was an error fetching the DICOM file:', error);
      return null;
    }
  };

  const uploadDicomToOrthanc = async (blob: Blob) => {
    try {
      console.log('Uploading DICOM file to Orthanc');
      const formData = new FormData();
      formData.append('file', blob, 'example.dcm');

      const orthancResponse = await axios.post(
        'https://orthanc.katelyncmorrison.com/pacs/instances',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      console.log('DICOM file uploaded to Orthanc');
    } catch (error) {
      console.error('Error uploading DICOM file to Orthanc:', error);
    }
  };

  const generateUniqueTimestamp = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  };

  const generateUniqueId = () => {
    return Math.random().toString(36).substr(2, 9);
  };

  const styles = {
    searchHomepage: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'linear-gradient(190deg, rgb(8, 31, 121), rgb(116, 155, 234), rgb(10, 17, 98))',
      animation: 'gradient 15s ease infinite',
    },
    title: {
      fontSize: '4rem',
      color: 'white',
      marginBottom: '20px',
      fontWeight: 'bold',
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
    },
    subtitle: {
      fontSize: '1.5rem',
      color: 'white',
      marginBottom: '20px',
      fontWeight: '300',
      fontStyle: 'italic',
    },
    searchBar: {
      width: '50%',
      padding: '15px',
      border: 'none',
      borderRadius: '25px',
      fontSize: '1.2rem',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      outline: 'none',
      marginBottom: '20px',
    },
    searchButton: {
      padding: '10px 20px',
      fontSize: '1.2rem',
      border: 'none',
      borderRadius: '25px',
      backgroundColor: '#2a5298',
      color: 'white',
      cursor: 'pointer',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    },
    modelStatus: {
      display: 'flex',
      alignItems: 'center',
      marginTop: '10px',
    },
    statusDot: {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      marginRight: '10px',
      backgroundColor: isModelRunning ? 'green' : 'red',
    },
    logs: {
      marginTop: '20px',
      color: 'white',
      fontSize: '1rem',
      textAlign: 'left' as const,
      width: '50%',
      maxHeight: '200px',
      overflowY: 'auto' as const,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: '10px',
      borderRadius: '10px',
    },
    '@keyframes gradient': {
      '0%': {
        background: 'linear-gradient(190deg, rgb(8, 31, 121), rgb(116, 155, 234), rgb(10, 17, 98))',
      },
      '50%': {
        background: 'linear-gradient(190deg, rgb(8, 31, 121), rgb(116, 155, 234), rgb(10, 17, 98))',
      },
      '100%': {
        background: 'linear-gradient(190deg, rgb(8, 31, 121), rgb(116, 155, 234), rgb(10, 17, 98))',
      },
    },
  };

  return (
    <div style={styles.searchHomepage}>
      <h1 style={styles.title}>MedImaGen</h1>
      <h3 style={styles.subtitle}>bringing custom pathologies to your finger tips</h3>
      <input
        type="text"
        style={styles.searchBar}
        placeholder="What do you want to generate...?"
        value={inputValue}
        onChange={handleInputChange}
      />
      <button
        style={styles.searchButton}
        onClick={handleGenerateClick}
        disabled={isLoading}
      >
        {isLoading ? 'Generating...' : 'Generate'}
      </button>
      <div style={styles.modelStatus}>
        <div style={styles.statusDot}></div>
        <span>{isModelRunning ? 'Model is running' : 'Model is off'}</span>
      </div>
      {logs.length > 0 && (
        <div style={styles.logs}>
          {logs.map((log, index) => (
            <div key={index}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchHomePage;
