import React from 'react';
import classnames from 'classnames';
import { getRenderingEngine, metaData, StackViewport } from '@cornerstonejs/core';
import applyHeatmapOverlay from './applyColormap';

import './ViewportOverlay.css';

// const foldername = 'test_rightpleur_noleft';
// const sampleNumber = 0;
const orthancServerUrl =
  window.location.hostname === 'localhost'
    ? 'http://localhost'
    : 'https://orthanc.katelyncmorrison.com';

export type ViewportOverlayProps = {
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  color?: string;
};
// Helper to get the series index from the study by matching SeriesInstanceUID
async function getSeriesIndex(studyInstanceUID, seriesInstanceUID) {
  console.log('📋 Study Instance UID:', studyInstanceUID);
  console.log('📋 Series Instance UID:', seriesInstanceUID);

  const currentStudy = await _getOrthancStudyByID(studyInstanceUID);
  if (!currentStudy || !currentStudy.Series) {
    console.warn('❌ Study not found or has no series.');
    return -1; // Return -1 if no series are found
  }

  console.log('📌 Available Series in Study:', currentStudy.Series);

  // ✅ Fetch each series' real SeriesInstanceUID from Orthanc
  const seriesMapping = await Promise.all(
    currentStudy.Series.map(async (seriesOrthancId, index) => {
      const seriesData = await _getOrthancSeriesByID(seriesOrthancId);

      if (!seriesData || !seriesData.MainDicomTags?.SeriesInstanceUID) {
        console.warn(`❌ No SeriesInstanceUID found for series UUID: ${seriesOrthancId}`);
        return null;
      }

      return {
        orthancId: seriesOrthancId,
        dicomSeriesUID: seriesData.MainDicomTags.SeriesInstanceUID,
        index: index, // Store the position in the array
      };
    })
  );

  // ✅ Remove null values (failed series)
  const validSeries = seriesMapping.filter(series => series !== null);

  console.log('🔍 Orthanc Series Mapping:', validSeries);

  // ✅ Find the matching series
  const foundSeries = validSeries.find(series => series.dicomSeriesUID === seriesInstanceUID);

  if (!foundSeries) {
    console.warn(`❌ Series not found in study for SeriesInstanceUID: ${seriesInstanceUID}`);
    return -1; // Return -1 if no match is found
  }

  console.log(`✅ Matched Series at Index: ${foundSeries.index}`);
  return foundSeries.index; // Return the series index
}

const _getOrthancSeriesByID = async seriesInstanceUID => {
  try {
    // Parameters to include in the request
    const params = new URLSearchParams({
      expand: 1,
      requestedTags: 'SeriesInstanceUID',
    });

    const response = await fetch(orthancServerUrl + `/pacs/series?${params.toString()}`);

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();

    // Filter the data to find the study with the given seriesInstanceUID
    const study = data.find(item => item.RequestedTags.SeriesInstanceUID === seriesInstanceUID);

    if (study) {
      return study;
    } else {
      console.error('No series found with no seriesInstanceUID: ', seriesInstanceUID);
      return null;
    }
  } catch (error) {
    // Log any errors that occur during the fetch operation
    console.error('There has been a problem with your fetch operation:', error);
    return null;
  }
};

const _getOrthancStudyByID = async studyInstanceUID => {
  try {
    // Parameters to include in the request
    const params = new URLSearchParams({
      expand: 1,
      requestedTags: 'StudyInstanceUID',
    });
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

const ViewportOverlay = ({
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
  color = 'text-primary-light',
}: ViewportOverlayProps) => {
  const overlay = 'absolute pointer-events-none viewport-overlay';

  return (
    <div
      className={classnames(
        color ? color : 'text-aqua-pale',
        'text-[13px]',
        'leading-5',
        'overlay-text'
      )}
    >
      <div
        data-cy={'viewport-overlay-top-left'}
        className={classnames(overlay, 'overlay-top left-viewport')}
      >
        {topLeft}
      </div>
      <div
        data-cy={'viewport-overlay-top-right'}
        className={classnames(overlay, 'overlay-top right-viewport-scrollbar')}
      >
        {topRight}

        {/* 🔹 Updated Explain Button */}
        <button
          style={{
            padding: '5px 10px',
            backgroundColor: '#00bcd4',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            borderRadius: '5px',
            pointerEvents: 'all',
          }}
          onClick={async event => {
            console.log('🟢 Explain button clicked!');
            // ✅ Find the viewport element dynamically
            let viewportElement = event.currentTarget
              .closest('.viewport-wrapper')
              ?.querySelector('.cornerstone-viewport-element');

            if (!viewportElement) {
              viewportElement = document.querySelector('.cornerstone-viewport-element'); // Fallback
            }

            if (!viewportElement) {
              console.warn('❌ No viewport element found!');
              return;
            }

            console.log('🖼️ Found Viewport Element:', viewportElement);

            // ✅ Retrieve viewport ID
            const viewportId = viewportElement.getAttribute('data-viewport-uid');
            if (!viewportId) {
              console.warn('❌ No valid viewport ID found!');
              return;
            }

            console.log('📌 Viewport ID:', viewportId);

            // ✅ Get the rendering engine and viewport
            const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
            if (!renderingEngine) {
              console.error('❌ No rendering engine found!');
              return;
            }

            const viewport = renderingEngine.getViewport(viewportId);
            if (!viewport) {
              console.error('❌ Viewport not found!');
              return;
            }

            if (!(viewport instanceof StackViewport)) {
              console.error('❌ Not a StackViewport.');
              return;
            }

            // ✅ Get the current image index and image ID
            const imageId = viewport.getCurrentImageId();
            console.log(imageId);

            // ✅ Retrieve Study Instance UID from metadata
            const studyInstanceUID = metaData.get('StudyInstanceUID', imageId);
            if (!studyInstanceUID) {
              console.warn('❌ No Study Instance UID found for this image!');
              return;
            }

            const seriesUID = metaData.get('SeriesInstanceUID', imageId);
            if (!seriesUID) {
              console.warn('❌ No Study Instance UID found for this image!');
              return;
            }

            const seriesInstanceUID = metaData.get('SeriesInstanceUID', imageId);
            const instanceNumber = metaData.get('InstanceNumber', imageId);

            console.log(`📋 Study Instance UID: ${studyInstanceUID}`);
            console.log(`📋 Series Instance UID: ${seriesInstanceUID}`);
            console.log(`📋 Instance Number: ${instanceNumber}`);

            const currentStudy = await _getOrthancStudyByID(studyInstanceUID);
            const series = currentStudy.Series;
            console.log('SERIES', series);
            console.log('SERIES', currentStudy.MainDicomTags.AccessionNumber);

            (async () => {
              // Assume studyInstanceUID and seriesInstanceUID have been retrieved earlier.
              console.log(`📋 Study Instance UID: ${studyInstanceUID}`);
              console.log(`📋 Series Instance UID: ${seriesInstanceUID}`);

              const seriesIndex = await getSeriesIndex(studyInstanceUID, seriesInstanceUID);
              if (seriesIndex !== null) {
                console.log('🔍 Found series index in study:', seriesIndex);
              } else {
                console.error(
                  '❌ Series not found in study for SeriesInstanceUID:',
                  seriesInstanceUID
                );
              }
            })();

            try {
              await applyHeatmapOverlay(
                viewportId,
                currentStudy.MainDicomTags.AccessionNumber,
                0,
                studyInstanceUID
              );
              // await applyHeatmapOverlay(viewportId, 'test_rightpleur_noleft', 0, studyInstanceUID);
            } catch (error) {
              console.error('❌ Error applying heatmap overlay:', error);
            }
          }}
        >
          Explain
        </button>
      </div>
      <div
        data-cy={'viewport-overlay-bottom-right'}
        className={classnames(overlay, 'overlay-bottom right-viewport-scrollbar')}
      >
        {bottomRight}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-left'}
        className={classnames(overlay, 'overlay-bottom left-viewport')}
      >
        {bottomLeft}
      </div>
    </div>
  );
};

export default ViewportOverlay;
