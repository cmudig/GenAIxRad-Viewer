import React, { useEffect, useState, Suspense } from 'react';
import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';

function RadiopaediaComponent({ commandsManager, extensionManager, servicesManager }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    async function fetchPrompt() {
      const { displaySetService } = servicesManager.services;
      const currentDisplaySet = displaySetService.getMostRecentDisplaySet();
      const seriesUID = currentDisplaySet.SeriesInstanceUID;
      if (!seriesUID) {
        console.error('No SeriesInstanceUID found in the current display set.');
        setUrl('https://radiopaedia.org/');
        return;
      }
      const seriesPrompt = await getMetadataFromSeries(seriesUID, 'SeriesPrompt');
      if (!seriesPrompt) {
        console.error('No SeriesPrompt found in the current display set.');
        setUrl('https://radiopaedia.org/');
        return;
      }
      const formattedSeriesPrompt = seriesPrompt.replace(/ /g, '+');
      setUrl(`https://radiopaedia.org/search?lang=us&modality=CT&q=${formattedSeriesPrompt}&scope=cases`);
    }
    fetchPrompt();
  }, [servicesManager]);

  return (
    <div className="p-4 bg-primary-dark text-white h-full">
      <iframe
        src={url}
        width="100%"
        height="100%"
        style={{ border: 'none' }}
        title="Embedded Radiopaedia Page"
      />
    </div>
  );
}

export default RadiopaediaComponent;
