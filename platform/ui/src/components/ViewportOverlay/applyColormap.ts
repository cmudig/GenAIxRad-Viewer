import { getRenderingEngine, Enums, StackViewport } from '@cornerstonejs/core';
import axios from 'axios';

// ✅ Register the WADO Image Loader
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
cornerstoneWADOImageLoader.configure({
  useWebWorkers: false, // ❌ Disable web workers
  decodeTask: {
    initializeCodecsOnStartup: true, // ✅ Initialize codecs in the main thread
    usePDFJS: false,
  },
});

const serverUrl =
  window.location.hostname === 'localhost'
    ? 'https://localhost:3443'
    : 'https://medsyn.katelyncmorrison.com';

const dicom_server_path = '/media/volume/gen-ai-volume/MedSyn/results/dicom_overlays/';

/**
 * Applies a heatmap overlay to all slices in the viewport.
 * @param {string} viewportUid - The viewport ID where the overlay should be applied.
 * @param {string} foldername - Folder containing the heatmap DICOMs.
 * @param {number} sampleNumber - The sample number of the heatmap.
 */
async function applyHeatmapOverlay(viewportUid, foldername, sampleNumber) {
  console.log('🔍 Fetching heatmap DICOMs from server...');

  try {
    // ✅ Fetch heatmap DICOM URLs from backend
    const dicomResponse = await axios.get(
      `${serverUrl}/attention-maps/${foldername}/${sampleNumber}`
    );

    if (!dicomResponse.data || !dicomResponse.data.dicom_files.length) {
      console.error('❌ No heatmap DICOMs found.');
      return;
    }

    // ✅ Construct full paths for `wadouri`
    const dicom_path_prefix = serverUrl + dicom_server_path + foldername;
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

    // Fetch heatmap DICOM paths
    const res = await axios.get(`${serverUrl}/attention-maps/${foldername}/${sampleNumber}`);
    if (!res.data?.dicom_files?.length) {
      return console.error('No heatmap DICOMs.');
    }

    // Construct `wadouri` image IDs
    const basePath = `${serverUrl}${dicom_server_path}${foldername}/${sampleNumber}`;
    const dicomurls = res.data.dicom_files.map(file => `wadouri:${basePath}/${file}`);
    // ✅ Ensure all heatmap image IDs are strings
    const heatmapStr = dicomurls.map(id => (typeof id === 'string' ? id : String(id)));

    // Swap the current CT stack for the composite stack.
    (viewport as any).setStack([{ imageIds: heatmapStr, opacity: 1 }]);

    viewport.render();
    console.log('✅ Heatmap overlay applied successfully!');
  } catch (error) {
    console.error('❌ Error applying heatmap overlay:', error);
  }
}

export default applyHeatmapOverlay;
