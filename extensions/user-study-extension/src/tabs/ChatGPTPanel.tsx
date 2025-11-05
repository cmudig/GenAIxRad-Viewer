import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';

type ChatGPTPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type AssistantConfig = {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
};

const LOCAL_STORAGE_KEY = 'chatgpt-panel-openai-key';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

const readConfig = (): AssistantConfig => {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawConfig = (window as any)?.config?.chatgptAssistant;

  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const { apiKey, endpoint, model, temperature } = rawConfig;

  return {
    apiKey: typeof apiKey === 'string' ? apiKey : undefined,
    endpoint: typeof endpoint === 'string' ? endpoint : undefined,
    model: typeof model === 'string' ? model : undefined,
    temperature: typeof temperature === 'number' ? temperature : undefined,
  };
};

const loadStoredKey = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? '';
  } catch (error) {
    console.warn('ChatGPTPanel: unable to read API key from storage', error);
    return '';
  }
};

const persistKey = (value: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (!value) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, value);
    }
  } catch (error) {
    console.warn('ChatGPTPanel: unable to persist API key', error);
  }
};

const ChatGPTPanel: React.FC<ChatGPTPanelProps> = ({ servicesManager }) => {
  const [{ activeViewportId }] = useViewportGrid();
  const config = useMemo(() => readConfig(), []);

  const [storedKey, setStoredKey] = useState(() => loadStoredKey());
  const [pendingKey, setPendingKey] = useState(storedKey);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const apiKey = config.apiKey ?? storedKey;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const model = config.model ?? DEFAULT_MODEL;
  const temperature = config.temperature ?? 0.2;

  const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService ?? null;

  const captureActiveViewport = useCallback(async (): Promise<string> => {
    if (!cornerstoneViewportService) {
      throw new Error('Cornerstone viewport service is unavailable.');
    }

    const viewportId = activeViewportId ?? cornerstoneViewportService.getActiveViewportId?.();

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
      console.warn('ChatGPTPanel: failed to read canvas', err);
      throw new Error(
        'Failed to capture the slice. Ensure the image server allows CORS and try again.'
      );
    }
  }, [activeViewportId, cornerstoneViewportService]);

  const abortInFlight = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  const handleSaveKey = useCallback(() => {
    setStoredKey(pendingKey);
    persistKey(pendingKey);
    setError('');
  }, [pendingKey]);

  const analyzeSlice = useCallback(async () => {
    abortInFlight();
    setIsBusy(true);
    setError('');
    setDescription('');

    try {
      if (!apiKey) {
        throw new Error('Add an OpenAI API key to run the analysis.');
      }

      const dataUrl = await captureActiveViewport();

      const controller = new AbortController();
      controllerRef.current = controller;

      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert radiology assistant, with expertise in identifying pleural effusion. Remember that the right and left sides are flipped. Describe only the imaging abnormalities you can see in the format of an impression. If the slice is normal, explicitly state that no abnormalities are visible. Do not provide more than 5 sentences of information.',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this CT slice and describe the visible abnormalities.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        let message = `OpenAI request failed (status ${response.status})`;

        try {
          const payload = await response.json();
          if (payload?.error?.message) {
            message = payload.error.message;
          }
        } catch (err) {
          // Swallow parsing errors and report the status only
        }

        throw new Error(message);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';

      if (!content) {
        throw new Error('OpenAI did not return a description.');
      }

      setDescription(content);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      const message = err?.message || 'Unexpected error while contacting OpenAI.';
      setError(message);
    } finally {
      controllerRef.current = null;
      setIsBusy(false);
    }
  }, [abortInFlight, apiKey, captureActiveViewport, endpoint, model, temperature]);

  return (
    <div className="flex h-full flex-col text-white">
      <div className="space-y-4">
        {!config.apiKey && (
          <div className="flex flex-col space-y-2">
            <label className="text-primary-light text-sm font-semibold">OpenAI API key</label>
            <input
              type="password"
              className="focus:ring-primary-main rounded bg-black/40 p-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2"
              value={pendingKey}
              onChange={event => setPendingKey(event.target.value.trim())}
              placeholder="sk-..."
            />
            <div className="flex items-center justify-between">
              <button
                className="bg-primary-main disabled:bg-primary-main/40 rounded px-3 py-1 text-sm font-semibold text-black transition disabled:cursor-not-allowed"
                onClick={handleSaveKey}
                disabled={pendingKey === storedKey}
              >
                Save key
              </button>
              {storedKey && (
                <button
                  className="text-xs text-red-300 hover:text-red-200"
                  onClick={() => {
                    setPendingKey('');
                    setStoredKey('');
                    persistKey('');
                  }}
                >
                  Clear stored key
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              The key is stored locally in this browser. Use a restricted key when possible.
            </p>
          </div>
        )}

        <button
          className="bg-primary-main hover:bg-primary-light disabled:bg-primary-main/40 w-full rounded px-4 py-2 font-semibold text-black transition duration-200 disabled:cursor-not-allowed"
          onClick={analyzeSlice}
          disabled={isBusy}
        >
          {isBusy ? 'Analyzing current slice…' : 'Describe abnormalities'}
        </button>

        {error && (
          <div className="rounded border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {description && !error && (
          <div className="border-primary-main/40 rounded border bg-black/40 p-3 text-sm leading-relaxed text-gray-100">
            {description}
          </div>
        )}

        {!isBusy && !error && !description && (
          <p className="text-sm text-gray-400">
            Capture the active viewport slice and send it to GPT for an abnormality summary.
          </p>
        )}
      </div>
    </div>
  );
};

export default ChatGPTPanel;
