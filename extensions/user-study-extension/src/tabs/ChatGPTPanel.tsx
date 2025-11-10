import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../../platform/app/src/firebase';

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
const DEFAULT_MODEL = 'gpt-5';

const QUESTION_PRESETS = [
  {
    id: 'describe',
    title: 'Describe the findings in this image.',
    prompt:
      'Analyze this CT slice and describe the visible abnormalities. Focus on pleural effusion and summarize the findings in no more than five sentences.',
  },
  {
    id: 'evidence',
    title: 'How do you know this scan contains a pleural effusion?',
    prompt:
      'Explain the specific imaging clues in this CT slice that support or refute the presence of a pleural effusion.',
  },
  {
    id: 'cardiomegaly',
    title: 'Is there evidence of cardiomegaly in this image?',
    prompt:
      'Assess the heart size in this CT slice and describe whether the findings suggest cardiomegaly. Mention any supporting measurements or visible cues.',
  },
];

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeQuestionRef = useRef<string | null>(null);
  const [isFetchingRemoteKey, setIsFetchingRemoteKey] = useState(false);
  const [remoteKeyError, setRemoteKeyError] = useState('');

  const apiKey = config.apiKey ?? storedKey;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const model = config.model ?? DEFAULT_MODEL;
  const temperature = config.temperature ?? 1;

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
    if (config.apiKey || storedKey) {
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
  }, [config.apiKey, storedKey]);

  const analyzeSlice = useCallback(
    async (questionId: string) => {
      const question = QUESTION_PRESETS.find(item => item.id === questionId) ?? QUESTION_PRESETS[0];

      abortInFlight();
      setQuestionErrors(prev => ({ ...prev, [question.id]: '' }));
      setAnswers(prev => ({ ...prev, [question.id]: '' }));
      setBusyQuestionId(question.id);
      activeQuestionRef.current = question.id;

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
                    text: question.prompt,
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
        const content =
          payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';

        if (!content) {
          throw new Error('OpenAI did not return a description.');
        }

        setAnswers(prev => ({ ...prev, [question.id]: content }));
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
        const message = err?.message || 'Unexpected error while contacting OpenAI.';
        setQuestionErrors(prev => ({ ...prev, [question.id]: message }));
      } finally {
        controllerRef.current = null;
        if (activeQuestionRef.current === question.id) {
          activeQuestionRef.current = null;
          setBusyQuestionId(null);
        }
      }
    },
    [abortInFlight, apiKey, captureActiveViewport, endpoint, model, temperature]
  );

  return (
    <div className="flex h-full flex-col text-white">
      <div className="space-y-6">
        {/* {!config.apiKey && (
          <div className="rounded-2xl bg-white/5 p-4 text-sm text-white shadow-inner shadow-black/40">
            {isFetchingRemoteKey && <p>Loading OpenAI credentials…</p>}
            {!isFetchingRemoteKey && remoteKeyError && (
              <p className="text-red-300">{remoteKeyError}</p>
            )}
            {!isFetchingRemoteKey && !remoteKeyError && storedKey && (
              <p className="text-white/70">OpenAI key loaded from secure storage.</p>
            )}
          </div>
        )} */}

        <div>
          <h2 className="text-base font-semibold">Q&amp;A</h2>
          <p className="text-sm text-white/70">Ask AI about the currently-viewed slice.</p>
        </div>

        <div className="flex flex-col gap-4">
          {QUESTION_PRESETS.map(question => {
            const answer = answers[question.id];
            const error = questionErrors[question.id];
            const isBusy = busyQuestionId === question.id;
            const hasResponse = Boolean(answer);
            const buttonLabel = isBusy ? 'Asking…' : hasResponse ? 'Ask Again' : 'Ask';

            return (
              <div
                key={question.id}
                className="rounded-3xl bg-[#0b1433] p-4 shadow-lg shadow-black/40"
              >
                <p className="font-mono text-sm text-white">{question.title}</p>
                {answer && (
                  <p className="text-primary-light mt-3 rounded-2xl bg-[#0e1c4a] p-3 text-sm leading-relaxed text-white">
                    {answer}
                  </p>
                )}
                {!answer && !error && !isBusy && (
                  <p className="mt-3 text-sm text-white/60">
                    No response yet. Send this question to the model to see its answer.
                  </p>
                )}
                {isBusy && !error && (
                  <p className="mt-3 text-sm text-white/70">Loading response from OpenAI…</p>
                )}
                {error && (
                  <p className="mt-3 rounded-2xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    className="bg-primary-main hover:bg-primary-light disabled:bg-primary-main/40 rounded-full px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed"
                    onClick={() => analyzeSlice(question.id)}
                    disabled={isBusy || !apiKey}
                  >
                    {buttonLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChatGPTPanel;
