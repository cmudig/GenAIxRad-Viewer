import axios from 'axios';
// Remove the import of fs and path as they are not compatible with the browser

// const orthancUrl = 'https://orthanc.katelyncmorrison.com/pacs';

const orthancUrl =
  window.location.hostname === 'localhost'
    ? '/dicom-web'
    : 'https://orthanc.katelyncmorrison.com/pacs';

const normalizeBaseUrl = (baseUrl: string) => (baseUrl || '').replace(/\/+$/, '');

const toOrthancUrl = (baseUrl: string, path: string) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
};

const dedupeStrings = (values: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const getOrthancBaseCandidates = () => {
  if (window.location.hostname === 'localhost') {
    // Local dev needs to support:
    // 1) Reverse-proxy paths (/pacs, /api, /studies)
    // 2) Direct Orthanc access as used in the notebook (http://localhost:8042/studies/...).
    return dedupeStrings([
      '/dicom-web',
      '/pacs',
      '',
      '/api',
      'http://localhost:8042',
      'http://127.0.0.1:8042',
      'http://localhost',
      'http://127.0.0.1',
    ]);
  }
  return dedupeStrings(['/api', orthancUrl]);
};

const requestWithOrthancBaseFallback = async (
  requestFn: (baseUrl: string) => Promise<any>
) => {
  let lastError: any = null;
  for (const baseUrl of getOrthancBaseCandidates()) {
    try {
      return await requestFn(baseUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

export const deleteSeries = async (seriesToDelete: string) => {
  const seriesUrl = `${orthancUrl}/series/`;
  const params = {
    expand: 1,
    requestedTags: 'SeriesInstanceUID',
  };

  try {
    const seriesResponse = await axios.get(seriesUrl, { params });
    const seriesId = seriesResponse.data
      .filter((entry: any) => entry.RequestedTags.SeriesInstanceUID === seriesToDelete)
      .map((entry: any) => entry.ID);

    for (const serieId of seriesId) {
      const serieResponse = await axios.delete(`${orthancUrl}/series/${serieId}`);
      if (serieResponse.status !== 200) {
        console.error(`Failed to delete series. Status code: ${serieResponse.status}`);
        console.error(`Response: ${serieResponse.data}`);
        return;
      }
      console.log(`Deleted Series: ${serieId}`);
    }
  } catch (error) {
    console.error('Error deleting series:', error);
  }
};

export const uploadDicomFolder = async (dicomFolder: string) => {
  console.log('Uploading DICOM folder to Orthanc...');
  const orthancUrl = 'https://orthanc.katelyncmorrison.com/pacs/instances';
  const chunkSize = 5 * 1024 * 1024; // 5MB

  try {
    const response = await axios.get(`${serverUrl}/files/${dicomFolder}`);
    const files = response.data;

    for (const file of files) {
      if (file.endsWith('.dcm')) {
        const dicomFilePath = `${serverUrl}/files/${dicomFolder}/${file}`;
        const fileResponse = await axios.get(dicomFilePath, { responseType: 'arraybuffer' });
        const fileBuffer = fileResponse.data;

        for (let i = 0; i < fileBuffer.byteLength; i += chunkSize) {
          const chunk = fileBuffer.slice(i, i + chunkSize);
          const response = await axios.post(orthancUrl, chunk, {
            headers: { 'Content-Type': 'application/dicom' },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });

          if (response.status !== 200) {
            console.error(`Failed to upload a chunk of ${file}. Status code: ${response.status}`);
            console.error(`Response: ${response.data}`);
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error uploading DICOM folder:', error);
  }
};

export const storeMetadata = async (
  seriesInstanceUid: string,
  metadata: any,
  jsonFilePath: string
) => {
  const data = JSON.parse(localStorage.getItem(jsonFilePath) || '{}');

  if (!data[seriesInstanceUid]) {
    data[seriesInstanceUid] = {};
  }

  for (const [key, value] of Object.entries(metadata)) {
    data[seriesInstanceUid][key] = value;
  }

  localStorage.setItem(jsonFilePath, JSON.stringify(data, null, 4));
  console.log(`Entry with study_instance_uid ${seriesInstanceUid} added or updated.`);
};

export const getOrthancStudyId = async (studyInstanceUid: string) => {
  if (!studyInstanceUid) {
    return null;
  }

  try {
    // Fast path: Orthanc supports filtering by StudyInstanceUID.
    const findByFilter = await requestWithOrthancBaseFallback(baseUrl =>
      axios.get(toOrthancUrl(baseUrl, '/studies'), {
        params: { StudyInstanceUID: studyInstanceUid },
      })
    );
    if (findByFilter.status === 200 && Array.isArray(findByFilter.data) && findByFilter.data.length) {
      const firstMatch = findByFilter.data[0];
      if (typeof firstMatch === 'string') {
        return firstMatch;
      }
      if (firstMatch?.ID) {
        return firstMatch.ID;
      }
    }

    const params = {
      expand: 1,
      requestedTags: 'StudyInstanceUID',
    };
    const response = await requestWithOrthancBaseFallback(baseUrl =>
      axios.get(toOrthancUrl(baseUrl, '/studies'), { params })
    );
    if (response.status !== 200 || !Array.isArray(response.data)) {
      console.error(`Network response was not ok. Status: ${response.status}`);
      return null;
    }

    const expandedMatch = response.data.find((item: any) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const requestedTagsUid = item?.RequestedTags?.StudyInstanceUID;
      const mainDicomTagsUid = item?.MainDicomTags?.StudyInstanceUID;
      return requestedTagsUid === studyInstanceUid || mainDicomTagsUid === studyInstanceUid;
    });
    if (expandedMatch?.ID) {
      return expandedMatch.ID;
    }

    // Some Orthanc setups ignore expand and return a plain ID array.
    const idOnlyStudies = response.data.filter((item: any) => typeof item === 'string');
    for (const orthancStudyId of idOnlyStudies) {
      try {
        const studyResponse = await requestWithOrthancBaseFallback(baseUrl =>
          axios.get(toOrthancUrl(baseUrl, `/studies/${orthancStudyId}`))
        );
        const studyUid =
          studyResponse?.data?.RequestedTags?.StudyInstanceUID ??
          studyResponse?.data?.MainDicomTags?.StudyInstanceUID;
        if (studyUid === studyInstanceUid) {
          return orthancStudyId;
        }
      } catch (error) {
        // Keep iterating IDs.
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching study ID:', error);
    return null;
  }
};

export const getMetadataFromStudyByKeys = async (
  studyInstanceUid: string,
  keys: string[]
): Promise<string | null> => {
  if (!Array.isArray(keys) || !keys.length) {
    return null;
  }

  const studyId = await getOrthancStudyId(studyInstanceUid);
  if (!studyId) {
    console.log(`No study found for StudyInstanceUID: ${studyInstanceUid}`);
    return null;
  }

  return getMetadataFromOrthancStudyIdByKeys(studyId, keys);
};

export const getPatientIdFromStudyInstanceUid = async (
  studyInstanceUid: string
): Promise<string | null> => {
  const studyId = await getOrthancStudyId(studyInstanceUid);
  if (!studyId) {
    return null;
  }

  const normalize = (value: any): string | null => {
    const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return text || null;
  };

  try {
    const studyResponse = await requestWithOrthancBaseFallback(baseUrl =>
      axios.get(toOrthancUrl(baseUrl, `/studies/${studyId}`))
    );
    const studyData = studyResponse?.data || {};

    const patientId =
      normalize(studyData?.PatientMainDicomTags?.PatientID) ||
      normalize(studyData?.MainDicomTags?.PatientID) ||
      normalize(studyData?.RequestedTags?.PatientID);

    if (patientId) {
      return patientId;
    }

    const parentPatientId = normalize(studyData?.ParentPatient);
    if (!parentPatientId) {
      return null;
    }

    const patientResponse = await requestWithOrthancBaseFallback(baseUrl =>
      axios.get(toOrthancUrl(baseUrl, `/patients/${parentPatientId}`))
    );
    const patientData = patientResponse?.data || {};

    return normalize(patientData?.MainDicomTags?.PatientID);
  } catch (error) {
    console.error('Error fetching PatientID from study:', error);
    return null;
  }
};

export const getMetadataFromOrthancStudyIdByKeys = async (
  studyId: string,
  keys: string[]
): Promise<string | null> => {
  if (!studyId || !Array.isArray(keys) || !keys.length) {
    return null;
  }

  for (const key of keys) {
    if (!key) {
      continue;
    }
    try {
      const response = await requestWithOrthancBaseFallback(baseUrl =>
        axios.get(toOrthancUrl(baseUrl, `/studies/${studyId}/metadata/${key}`), {
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      );

      if (response.status === 200) {
        const value = String(response.data ?? '').trim();
        if (value) {
          return value;
        }
      }
    } catch (error) {
      // Keep trying additional keys.
    }
  }

  return null;
};

export const addMetadataToStudy = async (studyInstanceUid: string, data: string, type: string) => {
  if (
    type !== 'Impressions' &&
    type !== 'Findings' &&
    type !== 'StudyDescription' &&
    type !== 'treatmentCondition'
  ) {
    console.error(
      `Invalid metadata type: ${type}. Must be either 'Impressions', 'Findings', or 'StudyDescription'.`
    );
    return;
  }

  const studyId = await getOrthancStudyId(studyInstanceUid);
  if (!studyId) {
    return;
  }

  try {
    const url = `${orthancUrl}/studies/${studyId}/metadata/${type}`;
    const headers = {
      'Content-Type': 'text/plain',
    };

    const response = await axios.put(url, data, { headers });
    if (response.status !== 200) {
      console.error(`Response not ok. Status: ${response.status}, Response text: ${response.data}`);
    }
  } catch (error) {
    console.error('Error adding metadata to study:', error);
  }
};

const getOrthancSeriesId = async (seriesInstanceUid: string) => {
  const params = {
    expand: 1,
    requestedTags: 'SeriesInstanceUID',
  };

  try {
    const response = await axios.get(`${orthancUrl}/series`, { params });
    if (response.status !== 200) {
      console.error(`Network response was not ok. Status: ${response.status}`);
      return null;
    }

    const series = response.data.find(
      (item: any) => item.RequestedTags.SeriesInstanceUID === seriesInstanceUid
    );
    return series ? series.ID : null;
  } catch (error) {
    console.error('Error fetching series ID:', error);
    return null;
  }
};

export const addMetadataToSeries = async (
  seriesInstanceUid: string,
  data: string,
  type: string
) => {
  if (type !== 'SeriesPrompt' && type !== 'SeriesPromptChanged') {
    console.error(`Invalid metadata type: ${type}.`);
    return;
  }

  const seriesId = await getOrthancSeriesId(seriesInstanceUid);
  if (!seriesId) {
    console.log(`No series found for SeriesInstanceUID: ${seriesInstanceUid}`);
    return;
  }

  try {
    const url = `${orthancUrl}/series/${seriesId}/metadata/${type}`;
    const headers = {
      'Content-Type': 'text/plain',
    };

    const response = await axios.put(url, data, { headers });
    if (response.status !== 200) {
      console.error(`Response not ok. Status: ${response.status}, Response text: ${response.data}`);
    } else {
      console.log(
        `Successfully changed ${type} metadata to ${data} for seriesInstanceUID`,
        seriesInstanceUid
      );
    }
  } catch (error) {
    console.error('Error adding metadata to series:', error);
  }
};

// http://localhost:8042/series/aa77768b-d6e100cb-5caf54c1-4fb657b3-cd476113/metadata/SeriesPrompt
export const getMetadataFromSeries = async (seriesInstanceUid: string, type: string) => {
  if (type !== 'SeriesPrompt' && type !== 'SeriesPromptChanged') {
    console.error(`Invalid metadata type: ${type}.`);
    return;
  }

  console.log('WHAT IS THE SERIES INSTANCE ID WE ARE TESTING: ', seriesInstanceUid);

  const seriesId = await getOrthancSeriesId(seriesInstanceUid);
  if (!seriesId) {
    console.log(`No series found for SeriesInstanceUID: ${seriesInstanceUid}`);
    return;
  }

  try {
    const url = `${orthancUrl}/series/${seriesId}/metadata/${type}`;
    const headers = {
      'Content-Type': 'text/plain',
    };

    const response = await axios.get(url, { headers });
    if (response.status !== 200) {
      console.error(`Response not ok. Status: ${response.status}, Response text: ${response.data}`);
    } else {
      return response.data;
    }
  } catch (error) {
    console.error('Error adding metadata to series:', error);
  }
};

export const getMetadataFromStudy = async (studyInstanceUid: string, type: string) => {
  if (type !== 'treatmentCondition') {
    console.error(`Invalid metadata type: ${type}.`);
    return;
  }

  const studyId = await getOrthancStudyId(studyInstanceUid);
  if (!studyId) {
    console.log(`No study found for StudyInstanceUID: ${studyInstanceUid}`);
    return;
  }

  try {
    const url = `${orthancUrl}/study/${studyId}/metadata/${type}`;
    const headers = {
      'Content-Type': 'text/plain',
    };

    const response = await axios.get(url, { headers });
    if (response.status !== 200) {
      console.error(`Response not ok. Status: ${response.status}, Response text: ${response.data}`);
    } else {
      return response.data;
    }
  } catch (error) {
    console.error('Error getting metadata from study:', error);
  }
};
