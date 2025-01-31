import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import dicomParser from 'dicom-parser';
import { uploadDicomFolder, addMetadataToStudy } from './dicom_helpers';

const serverUrl =
  window.location.hostname === 'localhost'
    ? 'https://localhost:3443' // Local development
    : 'https://medsyn.katelyncmorrison.com'; // Deployed server
const orthancServerUrl =
  window.location.hostname === 'localhost'
    ? 'https://localhost:4443'
    : 'https://orthanc.katelyncmorrison.com';

const SearchHomePage = () => {
  const [inputValue, setInputValue] = useState('');
  const [isModelRunning, setIsModelRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [oldModelIsRunning, setOldModelIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dataIsUploading, setDataIsUploading] = useState(false);
  const [generateClicked, setGenerateClicked] = useState(false);
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFileID, setGeneratedFileID] = useState(''); // Store the generated file ID
  const [studyID, setStudyId] = useState('');
  const navigate = useNavigate();
  const orthanc_notify = false;

  useEffect(() => {
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
              executeDownloadAndUpload(generatedFileID);
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
    checkModelIsRunning();
    const interval = setInterval(() => {
      checkModelIsRunning();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [generatedFileID]); // Add generatedFileID as a dependency

  useEffect(() => {
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
    const getServerLog = async () => {
      if (isModelRunning) {
        try {
          const response = await axios.get(`${serverUrl}/progress`);
          if (response.status === 200) {
            setLogs(prevLogs => [...prevLogs, `Model progress: ${response.data}`]);
          }
        } catch (error) {
          console.log('Error when getting server log:', error);
        }
      }
    };

    const interval = setInterval(getServerLog, 3000); // Check every 5 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, [isModelRunning]);

  // Trigger model generation and wait until completion
  const handleGenerateClick = async () => {
    if (isGenerating) {
      setIsGenerating(false);
      setIsLoading(false);
      setGenerateClicked(false);
      setLogs(prevLogs => [...prevLogs, 'Generation process stopped.']);
      return;
    }

    setIsLoading(true);
    setGenerateClicked(true); // Flag generation started
    setIsGenerating(true); // Set generating state to true
    setLogs(['Starting CT scan generation...']);

    const formattedDate = generateUniqueTimestamp();
    const firstTenLetters = inputValue.replace(/[^a-zA-Z]/g, '').slice(0, 10);
    const newGeneratedFileID = `${formattedDate}${firstTenLetters}`;
    setGeneratedFileID(newGeneratedFileID);
    const newStudyId = generateUniqueId(); // Generate a new unique ID
    setStudyId(newStudyId); // Set the new unique ID to the state

    const payload = {
      filename: `${newGeneratedFileID}.npy`,
      prompt: inputValue || null,
      description: 'Generated CT Scan',
      studyID: newStudyId, // Use the new unique ID
      studyInstanceUID: newStudyId, // Use the new unique ID
      patient_name: `Generated Patient ${newStudyId}`,
      patient_id: `Patient ${newStudyId}`,
    };

    const headers = {
      'Content-Type': 'application/json',
    };

    const url = `${serverUrl}/files/${newGeneratedFileID}`;

    console.log('🔵 Sending POST request to:', url);
    console.log('🟢 Payload:', payload);

    try {
      const response = await axios.post(url, payload, { headers });
      console.log('✅ Response:', response.data);
    } catch (error) {
      setLogs(prevLogs => [...prevLogs, `Error generating CT scan: ${error.message}`]);
    } finally {
      setIsLoading(false);
      setIsGenerating(false); // Reset the generating state
    }
  };

  // Function to download and upload images only after model is done generating
  const executeDownloadAndUpload = async generatedfileID => {
    try {
      console.log('Download and upload started for fileID: ', generatedfileID);
      const files = await _getFilesFromFolder(generatedfileID);

      setDataIsUploading(true);

      const uploadPromises = files.map(async filename => {
        try {
          const blob = await _fetchDicomFile(generatedfileID, filename);
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

      // Ensure studyID is correctly set before navigating
      if (studyID) {
        navigate(`/generative-ai?StudyInstanceUIDs=${studyID}`);
      } else {
        console.error('Study ID is not set');
      }
    } catch (error) {
      console.error('Error in downloading and uploading images:', error);
      setDataIsUploading(false); // Ensure uploading status is updated in case of an error
      throw error;
    }
  };

  const _getFilesFromFolder = async foldername => {
    setLogs(prevLogs => [...prevLogs, `Fetching files from folder: ${foldername}`]);
    try {
      // const folderWithSuffix = `${foldername}_sample_0`;
      // console.log('Fetching files from folder:', folderWithSuffix);
      const response = await axios.get(`${serverUrl}/files/${foldername}`);
      console.log('GET FILES RESPONSE:', response.data);
      return response.data; // Assuming the response contains a list of file names
    } catch (error) {
      console.error('Error fetching files:', error);
      setLogs(prevLogs => [...prevLogs, `Could not fetch files from folder: ${foldername}`]);
      throw error;
    }
  };

  const _fetchDicomFile = async (foldername, filename) => {
    try {
      const response = await axios.post(
        `${serverUrl}/files/${foldername}/${filename}`,
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

      await axios.post(orthancServerUrl + '/pacs/instances', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
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
    return Math.random().toString(11).substr(2, 9);
  };

  const styles = {
    searchHomepage: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background:
        'linear-gradient(190deg, rgb(220, 220, 220), rgb(240, 240, 240), rgb(210, 210, 210))',
      animation: 'gradient 15s ease infinite',
    },
    title: {
      fontSize: '4rem',
      color: 'indigo',
      marginBottom: '20px',
      fontWeight: 'bold',
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
    },
    subtitle: {
      fontSize: '1.5rem',
      color: 'indigo',
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
      backgroundColor: 'indigo',
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
      backgroundColor: isServerRunning ? 'green' : 'red',
    },
    logs: {
      marginTop: '20px',
      color: 'indigo',
      fontSize: '1rem',
      textAlign: 'left' as const,
      width: '50%',
      maxHeight: '20vh',
      overflowY: 'auto' as const,
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      padding: '10px',
      borderRadius: '10px',
    },
    logo: {
      width: '20vw', // Adjust the width as needed
      marginBottom: '20px',
    },
    '@keyframes gradient': {
      '0%': {
        background:
          'linear-gradient(190deg, rgb(220, 220, 220), rgb(240, 240, 240), rgb(210, 210, 210))',
      },
      '50%': {
        background:
          'linear-gradient(190deg, rgb(220, 220, 220), rgb(240, 240, 240), rgb(210, 210, 210))',
      },
      '100%': {
        background:
          'linear-gradient(190deg, rgb(220, 220, 220), rgb(240, 240, 240), rgb(210, 210, 210))',
      },
    },
  };

  return (
    <div style={styles.searchHomepage}>
      <img
        src={'/assets/logo.png'} // Ensure the path is correct relative to the public directory
        alt="Logo"
        style={styles.logo}
      />
      <h1 style={styles.title}>IndaigoMed</h1>
      <h3 style={styles.subtitle}>
        bringing AI-powered medical image search and generation to your finger tips
      </h3>
      <input
        type="text"
        style={styles.searchBar}
        placeholder="What do you want to generate...?"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)} // Add this line
      />
      <button
        style={styles.searchButton}
        onClick={handleGenerateClick}
        disabled={isLoading}
      >
        {isGenerating ? 'Stop Generation' : isLoading ? 'Generating...' : 'Generate'}
      </button>
      <div style={styles.modelStatus}>
        <div style={styles.statusDot}></div>
        <span>{isServerRunning ? 'Server is running' : 'Server is off'}</span>
      </div>
      {isGenerating && (
        <div style={{ width: '50%', marginTop: '20px' }}>
          <div style={{ width: `${progress}%`, height: '20px', backgroundColor: 'indigo' }}></div>
        </div>
      )}
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
