import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../../platform/app/src/firebase';

type ChatGPTPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type ProviderId = 'openai' | 'gemini';

type AssistantConfig = {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
};

type ProviderConfig = Partial<Record<ProviderId, AssistantConfig>>;

const PROVIDER_DEFAULTS: Record<ProviderId, Required<Omit<AssistantConfig, 'apiKey'>>> = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5',
    temperature: 1,
  },
  gemini: {
    endpoint:
      'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent',
    model: 'gemini-2.5-flash',
    temperature: 1,
  },
};

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
];

const LOCAL_STORAGE_KEY = 'chatgpt-panel-openai-key';
const DEFAULT_SYSTEM_PROMPT =
  'You are an expert radiology assistant, with expertise in identifying pleural effusion. Remember that the right and left sides are flipped. Describe only the imaging abnormalities you can see in the format of an impression. If the slice is normal, explicitly state that no abnormalities are visible. Do not provide more than 5 sentences of information.';
const DEFAULT_PROMPT =
  'Analyze this CT slice and describe the visible abnormalities. Focus on pleural effusion and summarize the findings in no more than five sentences.';

const readConfig = (): ProviderConfig => {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawConfig = (window as any)?.config?.chatgptAssistant;

  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const config: ProviderConfig = {};

  PROVIDERS.forEach(({ id }) => {
    const entry = (rawConfig as any)[id];
    if (entry && typeof entry === 'object') {
      const { apiKey, endpoint, model, temperature } = entry;
      config[id] = {
        apiKey: typeof apiKey === 'string' ? apiKey : undefined,
        endpoint: typeof endpoint === 'string' ? endpoint : undefined,
        model: typeof model === 'string' ? model : undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
      };
    }
  });

  // Backwards compatibility with the original flat config (assumed OpenAI)
  const { apiKey, endpoint, model, temperature } = rawConfig;
  if (apiKey || endpoint || model || typeof temperature === 'number') {
    config.openai = {
      ...(config.openai ?? {}),
      apiKey: typeof apiKey === 'string' ? apiKey : config.openai?.apiKey,
      endpoint: typeof endpoint === 'string' ? endpoint : config.openai?.endpoint,
      model: typeof model === 'string' ? model : config.openai?.model,
      temperature: typeof temperature === 'number' ? temperature : config.openai?.temperature,
    };
  }

  return config;
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
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [answers, setAnswers] = useState<Record<ProviderId, string>>({
    openai: '',
    gemini: '',
  });
  const [errors, setErrors] = useState<Record<ProviderId, string>>({
    openai: '',
    gemini: '',
  });
  const [busyProviders, setBusyProviders] = useState<Record<ProviderId, boolean>>({
    openai: false,
    gemini: false,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<number | null>(null);
  const [isFetchingRemoteKey, setIsFetchingRemoteKey] = useState(false);
  const [remoteKeyError, setRemoteKeyError] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [isFetchingGeminiKey, setIsFetchingGeminiKey] = useState(false);
  const [geminiKeyError, setGeminiKeyError] = useState('');

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

  useEffect(() => {
    if (config.openai?.apiKey || storedKey) {
      return;
    }

    let isMounted = true;
    setIsFetchingRemoteKey(true);
    setRemoteKeyError('');

    const fetchKey = async () => {
      try {
        const keyDoc = await getDoc(doc(db, 'api_keys', 'openAI'));
        if (!keyDoc.exists()) {
          throw new Error('OpenAI key is not configured in Firestore.');
        }
        const keyValue = keyDoc.get('key');
        if (typeof keyValue !== 'string' || !keyValue.trim()) {
          throw new Error('Firestore key entry is empty.');
        }
        if (isMounted) {
          setStoredKey(keyValue.trim());
          persistKey(keyValue.trim());
        }
      } catch (error: any) {
        if (isMounted) {
          setRemoteKeyError(error?.message || 'Failed to load OpenAI key.');
        }
      } finally {
        if (isMounted) {
          setIsFetchingRemoteKey(false);
        }
      }
    };

    fetchKey();

    return () => {
      isMounted = false;
    };
  }, [config.openai?.apiKey, storedKey]);

  useEffect(() => {
    if (config.gemini?.apiKey || geminiKey) {
      return;
    }

    let isMounted = true;
    setIsFetchingGeminiKey(true);
    setGeminiKeyError('');

    const fetchGeminiKey = async () => {
      try {
        const keyDoc = await getDoc(doc(db, 'api_keys', 'gemini'));
        if (!keyDoc.exists()) {
          throw new Error('Gemini key is not configured in Firestore.');
        }
        const keyValue = keyDoc.get('key');
        if (typeof keyValue !== 'string' || !keyValue.trim()) {
          throw new Error('Firestore Gemini key entry is empty.');
        }
        if (isMounted) {
          setGeminiKey(keyValue.trim());
        }
      } catch (error: any) {
        if (isMounted) {
          setGeminiKeyError(error?.message || 'Failed to load Gemini key.');
        }
      } finally {
        if (isMounted) {
          setIsFetchingGeminiKey(false);
        }
      }
    };

    fetchGeminiKey();

    return () => {
      isMounted = false;
    };
  }, [config.gemini?.apiKey, geminiKey]);

  const normalizeSettings = useCallback(
    (providerId: ProviderId): Required<AssistantConfig> & { apiKey?: string } => {
      const providerConfig = config[providerId] ?? {};
      return {
        apiKey: providerConfig.apiKey,
        endpoint: providerConfig.endpoint ?? PROVIDER_DEFAULTS[providerId].endpoint,
        model: providerConfig.model ?? PROVIDER_DEFAULTS[providerId].model,
        temperature: providerConfig.temperature ?? PROVIDER_DEFAULTS[providerId].temperature,
      };
    },
    [config]
  );

  const dataUrlToBase64 = (dataUrl: string): string => {
    const commaIndex = dataUrl.indexOf(',');
    return commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1);
  };

  const parseProviderResponse = (providerId: ProviderId, payload: any): string => {
    if (providerId === 'gemini') {
      const parts = payload?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return parts
          .map(part => part?.text)
          .filter(Boolean)
          .join('\n')
          .trim();
      }
      return '';
    }

    return payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';
  };

  const runPromptAcrossModels = useCallback(async () => {
    const userPrompt = prompt.trim();
    const activeSystemPrompt = systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;

    if (!userPrompt) {
      setErrors(prev => ({
        ...prev,
        openai: 'Enter a prompt to send to the models.',
        gemini: 'Enter a prompt to send to the models.',
      }));
      return;
    }

    abortInFlight();
    setErrors({ openai: '', gemini: '' });
    setAnswers({ openai: '', gemini: '' });
    setBusyProviders({ openai: true, gemini: true });

    const runId = Date.now();
    activeRunRef.current = runId;

    let dataUrl = '';
    let imageBase64 = '';

    try {
      dataUrl = await captureActiveViewport();
      imageBase64 = dataUrlToBase64(dataUrl);
    } catch (err: any) {
      const message = err?.message || 'Failed to capture the slice.';
      setErrors({
        openai: message,
        gemini: message,
      });
      setBusyProviders({ openai: false, gemini: false });
      activeRunRef.current = null;
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    await Promise.all(
      PROVIDERS.map(async provider => {
        try {
          const settings = normalizeSettings(provider.id);
          const apiKey =
            provider.id === 'openai'
              ? (settings.apiKey ?? storedKey)
              : (settings.apiKey ?? geminiKey);

          if (!apiKey) {
            throw new Error(`${provider.label} API key is missing.`);
          }

          let url = settings.endpoint;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          const body: any = {};

          if (provider.id === 'gemini') {
            // Gemini expects the API key as a query parameter, not a bearer token
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}key=${encodeURIComponent(apiKey)}`;
            body.contents = [
              {
                role: 'user',
                parts: [
                  { text: `${activeSystemPrompt}\n\n${userPrompt}` },
                  { inlineData: { mimeType: 'image/png', data: imageBase64 } },
                ],
              },
            ];
            body.generationConfig = { temperature: settings.temperature };
          } else {
            headers.Authorization = `Bearer ${apiKey}`;
            body.model = settings.model;
            body.temperature = settings.temperature;
            body.messages = [
              { role: 'system', content: activeSystemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: dataUrl,
                    },
                  },
                ],
              },
            ];
          }

          const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers,
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            let message = `${provider.label} request failed (status ${response.status})`;
            try {
              const payload = await response.json();
              if (payload?.error?.message) {
                message = payload.error.message;
              }
            } catch {
              // ignore JSON parse errors
            }
            throw new Error(message);
          }

          const payload = await response.json();
          const content = parseProviderResponse(provider.id, payload);

          if (!content) {
            throw new Error(`${provider.label} did not return a description.`);
          }

          if (activeRunRef.current === runId) {
            setAnswers(prev => ({ ...prev, [provider.id]: content }));
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            return;
          }
          if (activeRunRef.current === runId) {
            setErrors(prev => ({
              ...prev,
              [provider.id]: err?.message || `Unexpected error while contacting ${provider.label}.`,
            }));
          }
        } finally {
          if (activeRunRef.current === runId) {
            setBusyProviders(prev => ({ ...prev, [provider.id]: false }));
          }
        }
      })
    );

    if (activeRunRef.current === runId) {
      activeRunRef.current = null;
    }
    controllerRef.current = null;
  }, [abortInFlight, captureActiveViewport, normalizeSettings, prompt, storedKey]);

  return (
    <div className="flex h-full flex-col text-white">
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-semibold">Model comparison</h2>
          <p className="text-sm text-white/70">
            Send the same prompt to OpenAI and Gemini using the active slice.
          </p>
        </div>

        <div className="rounded-3xl bg-[#0b1433] p-4 shadow-lg shadow-black/40">
          <label className="flex items-center justify-between text-sm font-medium text-white">
            System prompt
            <span className="text-xs text-white/60">Guides model behavior</span>
          </label>
          <textarea
            className="ring-primary-main/30 mt-2 h-24 w-full resize-none rounded-2xl border border-white/10 bg-[#0e1c4a] p-3 text-sm text-white outline-none focus:ring-2"
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Set context or constraints for the models..."
          />
        </div>

        <div className="rounded-3xl bg-[#0b1433] p-4 shadow-lg shadow-black/40">
          <label className="flex items-center justify-between text-sm font-medium text-white">
            Prompt
            <span className="text-xs text-white/60">Used for all three models</span>
          </label>
          <textarea
            className="ring-primary-main/30 mt-2 h-28 w-full resize-none rounded-2xl border border-white/10 bg-[#0e1c4a] p-3 text-sm text-white outline-none focus:ring-2"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Ask anything about the current slice..."
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="bg-primary-main hover:bg-primary-light disabled:bg-primary-main/40 rounded-full px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed"
              onClick={runPromptAcrossModels}
              disabled={Object.values(busyProviders).some(Boolean)}
            >
              {Object.values(busyProviders).some(Boolean) ? 'Running…' : 'Ask all models'}
            </button>
          </div>
          {!config.openai?.apiKey && !storedKey && (
            <p className="mt-2 text-xs text-white/60">
              OpenAI key will be loaded from secure storage automatically when available.
            </p>
          )}
          {isFetchingRemoteKey && <p className="mt-2 text-xs text-white/70">Loading OpenAI key…</p>}
          {remoteKeyError && (
            <p className="mt-2 text-xs text-red-300">
              {remoteKeyError || 'Failed to load OpenAI key'}
            </p>
          )}
          {isFetchingGeminiKey && <p className="mt-2 text-xs text-white/70">Loading Gemini key…</p>}
          {geminiKeyError && (
            <p className="mt-2 text-xs text-red-300">
              {geminiKeyError || 'Failed to load Gemini key'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {PROVIDERS.map(provider => {
            const answer = answers[provider.id];
            const error = errors[provider.id];
            const isBusy = busyProviders[provider.id];
            const hasKey =
              provider.id === 'openai'
                ? Boolean(config.openai?.apiKey ?? storedKey)
                : Boolean(config.gemini?.apiKey ?? geminiKey);

            return (
              <div
                key={provider.id}
                className="rounded-3xl bg-[#0b1433] p-4 shadow-lg shadow-black/40"
              >
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm text-white">{provider.label}</p>
                  {!hasKey && <span className="text-xs text-red-300">Missing API key</span>}
                </div>

                {answer && (
                  <p className="text-primary-light mt-3 rounded-2xl bg-[#0e1c4a] p-3 text-sm leading-relaxed text-white">
                    {answer}
                  </p>
                )}

                {!answer && !error && !isBusy && (
                  <p className="mt-3 text-sm text-white/60">
                    No response yet. Run the prompt to see {provider.label}&apos;s answer.
                  </p>
                )}

                {isBusy && !error && (
                  <p className="mt-3 text-sm text-white/70">Waiting for {provider.label}…</p>
                )}

                {error && (
                  <p className="mt-3 rounded-2xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChatGPTPanel;
