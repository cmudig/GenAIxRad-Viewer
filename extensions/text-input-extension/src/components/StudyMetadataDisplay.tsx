import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import UserFeedback from './UserFeedback';
import { getRenderingEngine, metaData, StackViewport } from '@cornerstonejs/core';
import { getMetadataFromSeries } from '../../../../platform/app/src/components/dicom_helpers';

// example of setting the SeriesPrompt via the terminal:
// curl -X PUT "http://localhost:8042/pacs/series/b5da4164-106f1d99-2c273087-9c764fd8-ae12f84d/metadata/SeriesPrompt" \
// -d 'left rib fractures left bloody pleural effusion adjacent peripheral lung contusion small left pneumothorax' \
// -H "Content-Type: application/json"

const orthancServerUrl =
  window.location.hostname === 'localhost'
    ? 'http://localhost'
    : 'https://orthanc.katelyncmorrison.com';

const StudyMetadataDisplay = ({
  description,
  onClick,
  onDoubleClick,
  seriesInstanceUID,
  modality,
}) => {
  const [promptMetaData, setPromptMetaData] = useState('');
  const [seriesID, setSeriesID] = useState('');

  useEffect(() => {
    if (modality === 'AI') {
      const fetchMetadata = async () => {
        const response = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPrompt');
        if (!response) {
          console.warn('No SeriesPrompt metadata found for this series.');
          setPromptMetaData('No metadata found.');
          return;
        }
        setPromptMetaData(response || 'No metadata found.');
      };

      fetchMetadata();
    }
  }, [seriesInstanceUID, modality]);

  if (modality !== 'AI')
    return (
      <div
        className="group mb-8 flex flex-1 cursor-pointer flex-col px-3 outline-none"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <span className="text-primary-main mb-1 select-none font-bold">{description}</span>
      </div>
    );

  return (
    <div
      className="group mb-8 flex flex-1 cursor-pointer flex-col px-3 outline-none"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="text-primary-main mb-1 select-none font-bold">{description}</span>
      <div className="mt-1 break-all text-base text-blue-300">Prompt: </div>
      <div className="break-words text-base text-white">{promptMetaData ? promptMetaData : ''}</div>
      {<UserFeedback seriesID={seriesID} />}
    </div>
  );
};

StudyMetadataDisplay.propTypes = {
  impressions: PropTypes.string,
};

const _getPromptMetadataOfSeries = async seriesID => {
  try {
    const url = `${orthancServerUrl}/pacs/series/${seriesID}/metadata/SeriesPrompt`;
    console.log('📡 Fetching metadata from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`❌ Metadata fetch failed. Status: ${response.status}. Response: ${errorText}`);
      return null;
    }

    const metadataText = await response.text();
    console.log('✅ Retrieved SeriesPrompt metadata:', metadataText);
    return metadataText;
  } catch (error) {
    console.error('❌ Error fetching SeriesPrompt metadata:', error);
    return null;
  }
};

export default StudyMetadataDisplay;
