import { getRenderingEngine, Enums, StackViewport } from '@cornerstonejs/core';
import axios from 'axios';
import { DicomMetadataStore } from '@ohif/core';
import { utilities } from '@cornerstonejs/core';

// ✅ Register the WADO Image Loader
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';

// Generate a valid DICOM UID for the series
const seriesInstanceUID = utilities.uuidv4().replace(/-/g, '.');

// ✅ Register the loader
cornerstoneWADOImageLoader.configure({
  useWebWorkers: false,
  decodeTask: {
    initializeCodecsOnStartup: true,
    usePDFJS: false,
  },
});

const serverUrl =
  window.location.hostname === 'localhost'
    ? 'https://localhost:3443'
    : 'https://medsyn.katelyncmorrison.com';

/**
 * Applies a heatmap overlay to all slices in the viewport.
 * @param {string} viewportUid - The viewport ID where the overlay should be applied.
 * @param {string} foldername - Folder containing the heatmap DICOMs.
 * @param {number} sampleNumber - The sample number of the heatmap.
 */
async function applyHeatmapOverlay(viewportUid, foldername, sampleNumber, studyInstanceUID) {
  console.log('🔍 Fetching heatmap DICOMs from server...');

  try {
    // ✅ Fetch heatmap DICOM URLs from backend
    console.log('Our folder name is: ', foldername);
    console.log('Our sample number is: ', sampleNumber);
    const dicom_path_prefix = `${serverUrl}/dicom_files/${foldername}/${sampleNumber}`;

    const dicomResponse = await axios.get(dicom_path_prefix);

    if (!dicomResponse.data || !dicomResponse.data.dicom_files.length) {
      console.error('❌ No heatmap DICOMs found.');
      return;
    } else {
      console.log('✅ Fetched heatmap DICOMs:', dicomResponse.data.dicom_files);
    }

    // ✅ Construct full paths for `wadouri`
    const dicomUrls = dicomResponse.data.dicom_files.map(
      fileName => `wadouri:${dicom_path_prefix}/${fileName}`
    );

    console.log('📡 Constructed heatmap `wadouri` URLs:', dicomUrls);

    // ✅ Get rendering engine and viewport
    const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
    if (!renderingEngine) {
      console.error('❌ Rendering Engine not found!');
      return;
    }

    const viewport = renderingEngine.getViewport(viewportUid);
    if (!viewport) {
      console.error('❌ Viewport not found!');
      return;
    }

    if (!(viewport instanceof StackViewport)) {
      return console.error('Not a StackViewport.');
    }

    const studyMetadata = DicomMetadataStore.getStudy(studyInstanceUID);

    console.log('📝 Registering new temporary series in OHIF metadata store...');
    const newSeriesMetadata = {
      StudyInstanceUID: studyInstanceUID,
      SeriesInstanceUID: seriesInstanceUID,
      SeriesDescription: 'Temporary Heatmap Overlay',
      Modality: 'OT',
      NumberOfSeriesRelatedInstances: dicomUrls.length,
      ImageIds: dicomUrls,
    };

    studyMetadata.series.push(newSeriesMetadata);
    DicomMetadataStore.addSeriesMetadata([newSeriesMetadata], true);

    DicomMetadataStore._broadcastEvent('SERIES_ADDED', {
      StudyInstanceUID: studyInstanceUID,
      seriesSummaryMetadata: [newSeriesMetadata],
      madeInClient: true,
    });

    viewport.resetCamera();
    // Swap the current CT stack for the composite stack.
    await viewport.setStack(dicomUrls); // Start from first slice

    viewport.render();

    console.log('✅ Heatmap overlay applied successfully!');
  } catch (error) {
    console.error('❌ Error applying heatmap overlay from ColorMap:', error);
  }
}

export default applyHeatmapOverlay;
