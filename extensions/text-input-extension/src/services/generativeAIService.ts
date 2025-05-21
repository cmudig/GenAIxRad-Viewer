import axios from 'axios';

const serverUrl = window.location.hostname === 'localhost'
  ? 'https://localhost:3443'
  : 'https://medsyn.katelyncmorrison.com';

const orthancServerUrl = window.location.hostname === 'localhost'
  ? 'http://localhost'
  : 'https://orthanc.katelyncmorrison.com';

export async function checkServerStatus(): Promise<boolean> {
  try {
    const response = await axios.get(serverUrl);
    return response.status === 200;
  } catch {
    return false;
  }
}


export async function checkModelIsRunning() {
  const response = await axios.get(`${serverUrl}/status`);
  return response.data['process_is_running'];
}

export async function sendPromptAndStartGeneration(payload: any, fileID: string) {
  const url = `${serverUrl}/files/${fileID}`;
  const headers = { 'Content-Type': 'application/json' };
  const response = await axios.post(url, payload, { headers });
  return response.data;
}

// Add similar functions:
// - downloadAndUploadImages
// - addMetadataToSeries
// - getOrthancStudyByID
