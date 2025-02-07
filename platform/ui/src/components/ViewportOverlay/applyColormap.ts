import { getRenderingEngine } from '@cornerstonejs/core';
import axios from 'axios';
import { fromArrayBuffer } from 'numpy-parser';

const serverUrl =
  window.location.hostname === 'localhost'
    ? 'https://localhost:3443'
    : 'https://medsyn.katelyncmorrison.com';

/**
 * Fetches the heatmap and applies it to the active viewport based on its orientation.
 */
export async function applyHeatmapOverlay(viewportUid, foldername, sampleNumber) {
  console.log('🔍 Inside applyHeatmapOverlay()');
  console.log('🖼️ Received Viewport UID:', viewportUid);
  console.log('📂 Folder Name:', foldername, '| 🔢 Sample Number:', sampleNumber);

  // ✅ Get the rendering engine first
  const renderingEngine = getRenderingEngine('OHIFCornerstoneRenderingEngine');
  if (!renderingEngine) {
    console.error('❌ Rendering Engine not found!');
    return;
  }
  console.log('✅ Rendering Engine Found:', renderingEngine);

  // ✅ Get the enabled viewport
  const viewport = renderingEngine.getViewport(viewportUid);
  if (!viewport) {
    console.error('❌ Viewport not found!');
    return;
  }
  console.log('✅ Enabled viewport detected!');

  // 🔹 Detect View Type based on camera normal
  const camera = viewport.getCamera();
  const { viewPlaneNormal } = camera;
  let viewType;
  if (Math.abs(viewPlaneNormal[2]) > 0.9) {
    viewType = 'Axial';
  } else if (Math.abs(viewPlaneNormal[1]) > 0.9) {
    viewType = 'Coronal';
  } else {
    viewType = 'Sagittal';
  }
  console.log('🖥️ Corrected View Type:', viewType);

  try {
    const heatmapUrl = `${serverUrl}/attention-maps/${foldername}/${sampleNumber}`;
    console.log('📡 Fetching heatmap from:', heatmapUrl);

    const response = await axios.get(heatmapUrl, {
      responseType: 'arraybuffer',
    });
    console.log('📦 Raw Response:', response.data);
    if (!response.data) {
      console.error('❌ No data received for heatmap');
      return;
    }

    const npyData = fromArrayBuffer(response.data);
    console.log('✅ Parsed NPY Data Shape:', npyData.shape);
    if (!npyData || !npyData.data) {
      console.error('❌ Invalid .npy file format');
      return;
    }
    console.log('✅ Successfully loaded heatmap:', npyData.data);
    console.log('🔍 Checking npyData Shape:', npyData.shape);
    // --- Squeeze out a singleton dimension if it exists ---
    // For example, if npyData.shape is [num_heads, 1, slices, height, width],
    // remove the singleton dimension at index 1.
    if (npyData.shape[1] === 1) {
      console.log('🔄 Singleton dimension detected at index 1, removing it.');
      npyData.shape = [npyData.shape[0], ...npyData.shape.slice(2)];
    }
    console.log('🔍 Checking npyData Shape after singleton:', npyData.shape);

    // 🔹 Reshape heatmap to match Python processing
    const num_heads = npyData.shape[0];
    const slices = npyData.shape[2];
    const height = npyData.shape[3];
    const width = npyData.shape[4];
    console.log(
      `📏 Reshaping Heatmap: Heads=${num_heads}, Slices=${slices}, Height=${height}, Width=${width}`
    );
    const reshapedHeatmap = reshapeHeatmap(npyData.data, num_heads, slices, height, width);
    console.log('✅ Reshaped Heatmap:', reshapedHeatmap.length, reshapedHeatmap[0].length);

    // 🔹 Extract the correct slice
    const sliceIndex = Math.floor(slices / 2);
    let extractedHeatmap;
    if (viewType === 'Axial') {
      console.log(`📌 Extracting Axial slice at index ${sliceIndex}`);
      extractedHeatmap = reshapedHeatmap.map(head => head[sliceIndex]);
    } else if (viewType === 'Coronal') {
      console.log(`📌 Extracting Coronal slice at index ${sliceIndex}`);
      extractedHeatmap = reshapedHeatmap.map(head => head.map(slice => slice[sliceIndex]));
    } else {
      console.log(`📌 Extracting Sagittal slice at index ${sliceIndex}`);
      extractedHeatmap = reshapedHeatmap.map(head =>
        head.map(slice => slice.map(row => row[sliceIndex]))
      );
    }
    console.log(`📏 Extracted ${viewType} Slice at index ${sliceIndex}`);
    console.log('📏 Extracted Heatmap Shape:', extractedHeatmap.length, extractedHeatmap[0].length);

    // ✅ Average across attention heads element-wise
    const numHeads = extractedHeatmap.length;
    const numRows = extractedHeatmap[0].length;
    const numCols = extractedHeatmap[0][0].length;
    const averagedHeatmap = [];
    for (let r = 0; r < numRows; r++) {
      averagedHeatmap[r] = [];
      for (let c = 0; c < numCols; c++) {
        let sum = 0;
        for (let h = 0; h < numHeads; h++) {
          sum += extractedHeatmap[h][r][c];
        }
        averagedHeatmap[r][c] = sum / numHeads;
      }
    }
    extractedHeatmap = averagedHeatmap;
    console.log(
      '📏 Extracted Heatmap Shape AFTER Averaging:',
      extractedHeatmap.length,
      extractedHeatmap[0]?.length
    );

    // 🔹 Ensure the heatmap is 2D before resizing
    if (!Array.isArray(extractedHeatmap[0])) {
      console.log('🔄 Reshaping 1D Heatmap to 2D before resizing...');
      extractedHeatmap = [extractedHeatmap];
    }

    // 🔹 Resize heatmap to 256×256 using the corrected scale factors
    const resizedHeatmap = resizeHeatmap(extractedHeatmap, 256, 256);
    console.log('📏 Resized Heatmap Shape:', resizedHeatmap.length, resizedHeatmap[0].length);

    const normalizedHeatmap = normalizeHeatmap(resizedHeatmap);

    // 🔹 Overlay heatmap onto viewport
    overlayHeatmapOnViewport(viewport, normalizedHeatmap);
    console.log('✅ Heatmap overlay applied successfully');
  } catch (error) {
    console.error('❌ Error applying heatmap overlay:', error);
  }
}

/**
 * Resizes a 2D array to the target width and height.
 */
function resizeHeatmap(heatmap, targetWidth, targetHeight) {
  const resized = new Array(targetHeight).fill(0).map(() => new Array(targetWidth).fill(0));

  const scaleY = heatmap.length / targetHeight; // rows → height
  const scaleX = heatmap[0].length / targetWidth; // columns → width

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcY = Math.floor(y * scaleY);
      const srcX = Math.floor(x * scaleX);
      resized[y][x] = heatmap[srcY][srcX];
    }
  }
  return resized;
}

function reshapeHeatmap(data, num_heads, slices, height, width) {
  const reshaped = [];
  let index = 0;
  for (let h = 0; h < num_heads; h++) {
    const head = [];
    for (let s = 0; s < slices; s++) {
      const slice = [];
      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
          row.push(data[index++]);
        }
        slice.push(row);
      }
      head.push(slice);
    }
    reshaped.push(head);
  }
  return reshaped;
}

function overlayHeatmapOnViewport(viewport, heatmap) {
  const canvasSize = 256;
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = canvasSize;
  overlayCanvas.height = canvasSize;
  const ctx = overlayCanvas.getContext('2d');

  const imageData = ctx.createImageData(canvasSize, canvasSize);

  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      // Get the heatmap value at this pixel (make sure it is in 0-255 range,
      // or adjust accordingly)
      const value = heatmap[y][x];
      // Calculate the index in the flat ImageData array.
      const idx = (y * canvasSize + x) * 4;
      imageData.data[idx] = value; // Red channel
      imageData.data[idx + 1] = 0; // Green channel
      imageData.data[idx + 2] = 255 - value; // Blue channel (inverted for effect)
      imageData.data[idx + 3] = 180; // Alpha (transparency)
    }
  }

  ctx.putImageData(imageData, 0, 0);
  viewport.element.appendChild(overlayCanvas);
  console.log('✅ Heatmap overlay added to viewport');
}

function normalizeHeatmap(heatmap) {
  let min = Infinity;
  let max = -Infinity;

  // Find the min and max values
  for (const row of heatmap) {
    for (const value of row) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }

  // Normalize each value in the heatmap to the 0-255 range
  const normalized = heatmap.map(row =>
    row.map(value => {
      // Prevent division by zero in case min and max are the same
      if (max === min) {
        return 0;
      }
      return Math.round(((value - min) / (max - min)) * 255);
    })
  );

  return normalized;
}
