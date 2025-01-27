import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const serverUrl = 'https://medsyn.katelyncmorrison.com';
const orthancServerUrl = 'https://orthanc.katelyncmorrison.com';

const SearchHomePage = () => {
  const [inputValue, setInputValue] = useState('');
  const [isModelRunning, setIsModelRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const checkModelStatus = async () => {
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

    checkModelStatus();
    const interval = setInterval(checkModelStatus, 60000); // Check every 60 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleGenerateClick = async () => {
    setIsLoading(true);
    setLogs(['Starting CT scan generation...']);
    try {
      const studyId = generateUniqueId();
      await createStudyInOrthanc(studyId);
      const response = await generateCTScan(inputValue, studyId);
      if (response.success) {
        setLogs(prevLogs => [...prevLogs, 'CT scan generation in progress...']);
        await pollForCompletion(response.studyId);
      } else {
        setLogs(prevLogs => [...prevLogs, 'Failed to generate CT scan']);
      }
    } catch (error) {
      setLogs(prevLogs => [...prevLogs, 'Error generating CT scan:', error.message]);
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
      const response = await axios.post(`${serverUrl}/files/${fileID}`, payload, { headers });
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

  const createStudyInOrthanc = async (studyId: string) => {
    const payload = {
      MainDicomTags: {
        StudyInstanceUID: studyId,
        PatientName: 'Generated Patient',
        PatientID: '12345',
        StudyDescription: 'Generated CT Scan',
      },
    };

    try {
      await axios.post(`${orthancServerUrl}/studies`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
      setLogs(prevLogs => [...prevLogs, 'Study created in Orthanc']);
    } catch (error) {
      console.error('Error creating study in Orthanc:', error);
      setLogs(prevLogs => [...prevLogs, 'Error creating study in Orthanc:', error.message]);
    }
  };

  const pollForCompletion = async (studyId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`${serverUrl}/status/${studyId}`);
        if (response.data.status === 'completed') {
          clearInterval(interval);
          setLogs(prevLogs => [
            ...prevLogs,
            'CT scan generated successfully. Redirecting to viewer...',
          ]);
          await downloadAndUploadImages(studyId);
          navigate(`/generative-ai?StudyInstanceUIDs=${studyId}`);
        }
      } catch (error) {
        console.error('Error checking generation status:', error);
      }
    }, 5000); // Check every 5 seconds
  };

  const downloadAndUploadImages = async (fileID: string) => {
    try {
      setLogs(prevLogs => [...prevLogs, 'Downloading images...']);
      const files = await getFilesFromFolder(fileID);
      const uploadPromises = files.map(async filename => {
        const blob = await fetchDicomFile(fileID, filename);
        if (blob) {
          await uploadDicomToOrthanc(blob);
        }
      });
      await Promise.all(uploadPromises);
      setLogs(prevLogs => [...prevLogs, 'CT scan uploaded successfully']);
    } catch (error) {
      console.error('Error in downloading and uploading images:', error);
      setLogs(prevLogs => [
        ...prevLogs,
        'Error in downloading and uploading images:',
        error.message,
      ]);
    }
  };

  const getFilesFromFolder = async (foldername: string) => {
    try {
      const response = await axios.get(`${serverUrl}/files/${foldername}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching files:', error);
      throw error;
    }
  };

  const fetchDicomFile = async (foldername: string, filename: string) => {
    try {
      const response = await axios.post(
        `${serverUrl}/files/${foldername}/${filename}`,
        { data: 'example' },
        {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
        }
      );
      const arrayBuffer = response.data;
      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
      return blob;
    } catch (error) {
      console.error('Error fetching DICOM file:', error);
      return null;
    }
  };

  const uploadDicomToOrthanc = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'example.dcm');
      await axios.post(`${orthancServerUrl}/pacs/instances`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
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
      <h3 style={styles.subtitle}>bringing tailored pathologies to your finger tips</h3>
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
      {isLoading && (
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
