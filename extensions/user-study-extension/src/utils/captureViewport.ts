/**
 * Captures the currently-active OHIF viewport as a PNG data URL.
 * Extracted from ChatGPTPanel so multiple consumers can share it.
 */
export async function captureActiveViewport(
  servicesManager: any,
  activeViewportId: string | null
): Promise<string> {
  const cornerstoneViewportService =
    servicesManager?.services?.cornerstoneViewportService ?? null;

  if (!cornerstoneViewportService) {
    throw new Error('Cornerstone viewport service is unavailable.');
  }

  const viewportId =
    activeViewportId ?? cornerstoneViewportService.getActiveViewportId?.();

  if (!viewportId) {
    throw new Error('No active viewport selected.');
  }

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  if (!viewport) {
    throw new Error('Viewport is not ready yet. Try again in a moment.');
  }

  viewport.render?.();

  const canvas = viewport.getCanvas?.();

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Unable to access viewport canvas.');
  }

  try {
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('captureViewport: failed to read canvas', err);
    throw new Error(
      'Failed to capture the slice. Ensure the image server allows CORS and try again.'
    );
  }
}
