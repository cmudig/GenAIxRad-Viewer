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

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  questionId?: string;
  status?: 'pending' | 'done' | 'error';
};

const LOCAL_STORAGE_KEY = 'chatgpt-panel-gemini-key';
const CHAT_STATE_KEY = 'chatgpt-panel-chat-state';

const DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent';
const BASE_SYSTEM_PROMPT =
  'You are an expert radiology assistant, with expertise in identifying abnormalities in the chest. Remember that the right and left sides are flipped. If the slice is normal, explicitly state that no abnormalities are visible. Do not provide more than 5 sentences of information.';

const QUESTION_PRESETS = [
  {
    id: 'describe',
    title: 'Describe the findings in this image.',
    prompt:
      'Analyze this CT slice and report your impression of the visible abnormalities. Report your response as IMPRESSION:',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
  {
    id: 'counterfactual',
    title: 'Describe what needs to change for the slice to appear normal.',
    prompt:
      'Analyze this CT slice and provide a description of what visually would need to change for the slice to appear normal.',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
  {
    id: 'mimic',
    title: 'Describe potential mimics of the abnormalities in this slice.',
    prompt:
      'Analyze this CT slice and describe what abnormalities may be mistaken for the true impression.',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
];

const readConfig = (): AssistantConfig => {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawConfig = (window as any)?.config?.gemini || (window as any)?.config?.chatgptAssistant;

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

const loadChatState = (): { messages: ChatMessage[]; unlockedPresetCount: number } | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CHAT_STATE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      unlockedPresetCount: QUESTION_PRESETS.length,
    };
  } catch {
    return null;
  }
};

const persistChatState = (state: { messages: ChatMessage[]; unlockedPresetCount: number }) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('ChatGPTPanel: unable to persist chat state', err);
  }
};

const ChatGPTPanel: React.FC<ChatGPTPanelProps> = ({ servicesManager }) => {
  const [{ activeViewportId }] = useViewportGrid();
  const config = useMemo(() => readConfig(), []);

  const [storedKey, setStoredKey] = useState(() => loadStoredKey());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const [unlockedPresetCount, setUnlockedPresetCount] = useState(QUESTION_PRESETS.length);
  const controllerRef = useRef<AbortController | null>(null);
  const activeQuestionRef = useRef<string | null>(null);
  const [isFetchingRemoteKey, setIsFetchingRemoteKey] = useState(false);
  const [remoteKeyError, setRemoteKeyError] = useState('');
  const messageCounterRef = useRef(0);
  const didHydrateRef = useRef(false);

  const apiKey = config.apiKey ?? storedKey;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
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

  // Hydrate chat state on first mount
  useEffect(() => {
    if (didHydrateRef.current) {
      return;
    }
    const stored = loadChatState();
    if (stored) {
      setMessages(stored.messages);
      setUnlockedPresetCount(QUESTION_PRESETS.length);
      messageCounterRef.current = stored.messages.length;
    }
    didHydrateRef.current = true;
  }, []);

  // Persist chat state when it changes (after initial hydration)
  useEffect(() => {
    if (!didHydrateRef.current) {
      return;
    }
    persistChatState({ messages, unlockedPresetCount });
  }, [messages, unlockedPresetCount]);

  useEffect(() => {
    if (config.apiKey || storedKey) {
      return;
    }

    let isMounted = true;
    setIsFetchingRemoteKey(true);
    setRemoteKeyError('');

    const fetchKey = async () => {
      try {
        const keyDoc = await getDoc(doc(db, 'api_keys', 'gemini'));
        if (!keyDoc.exists()) {
          throw new Error('Gemini key is not configured in Firestore.');
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
          setRemoteKeyError(error?.message || 'Failed to load Gemini key.');
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

  const nextMessageId = useCallback(() => {
    const next = messageCounterRef.current + 1;
    messageCounterRef.current = next;
    return `msg-${Date.now()}-${next}`;
  }, []);

  const addMessage = useCallback(
    (message: Omit<ChatMessage, 'id'> & { id?: string }) => {
      const id = message.id ?? nextMessageId();
      const payload: ChatMessage = { ...message, id };
      setMessages(prev => [...prev, payload]);
      return id;
    },
    [nextMessageId]
  );

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, ...updates } : msg)));
  }, []);

  const askQuestion = useCallback(
    async (questionId: string) => {
      const question = QUESTION_PRESETS.find(item => item.id === questionId) ?? QUESTION_PRESETS[0];
      const questionIndex = QUESTION_PRESETS.findIndex(item => item.id === question.id);

      abortInFlight();
      setBusyQuestionId(question.id);
      activeQuestionRef.current = question.id;

      addMessage({
        role: 'user',
        text: question.title,
        questionId: question.id,
        status: 'done',
      });

      const pendingAssistantId = addMessage({
        role: 'assistant',
        text: 'Analyzing slice…',
        questionId: question.id,
        status: 'pending',
      });

      try {
        if (!apiKey) {
          throw new Error('Add a Gemini API key to run the analysis.');
        }

        const dataUrl = await captureActiveViewport();

        const controller = new AbortController();
        controllerRef.current = controller;

        const base64Data = dataUrl.split(',')[1] || '';

        const url = endpoint.includes('?')
          ? `${endpoint}&key=${apiKey}`
          : `${endpoint}?key=${apiKey}`;

        const systemPrompt = question.system_prompt || BASE_SYSTEM_PROMPT;

        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: systemPrompt,
                  },
                  {
                    text: question.prompt,
                  },
                  {
                    inline_data: {
                      mime_type: 'image/png',
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature,
              candidateCount: 1,
            },
          }),
        });

        if (!response.ok) {
          let message = `Gemini request failed (status ${response.status})`;

          try {
            const payload = await response.json();
            if (payload?.error?.message) {
              message = payload.error.message;
            }
          } catch (err) {
            /* ignore parse errors */
          }

          throw new Error(message);
        }

        const payload = await response.json();

        const extractContent = () => {
          const parts = payload?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            return parts
              .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
              .filter(Boolean)
              .join('\n\n');
          }
          return payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';
        };

        const content = extractContent();

        if (!content) {
          throw new Error('Gemini did not return a description.');
        }

        updateMessage(pendingAssistantId, { text: content, status: 'done' });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          updateMessage(pendingAssistantId, { text: 'Request canceled.', status: 'error' });
          return;
        }
        const message = err?.message || 'Unexpected error while contacting Gemini.';
        updateMessage(pendingAssistantId, { text: message, status: 'error' });
      } finally {
        controllerRef.current = null;
        if (activeQuestionRef.current === question.id) {
          activeQuestionRef.current = null;
          setBusyQuestionId(null);
        }
      }
    },
    [abortInFlight, addMessage, apiKey, captureActiveViewport, endpoint, temperature, updateMessage]
  );

  return (
    <div className="flex h-full flex-col text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Q&amp;A</h2>
          <p className="text-sm text-white/70">Ask AI about the current slice via quick prompts.</p>
        </div>
        {!apiKey && (
          <p className="text-xs text-red-200">
            Add a Gemini API key to enable chat.
            {isFetchingRemoteKey ? ' Loading key…' : remoteKeyError ? ` ${remoteKeyError}` : ''}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUESTION_PRESETS.map(question => {
          const isBusy = busyQuestionId === question.id;
          return (
            <button
              key={question.id}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                isBusy
                  ? 'cursor-wait border-[#8fb5ff] bg-[#1f3f8f] text-white'
                  : 'border-[#8fb5ff] bg-[#1f3f8f] text-white hover:bg-[#234ca8]'
              } ${!apiKey ? 'cursor-not-allowed opacity-60' : ''}`}
              onClick={() => askQuestion(question.id)}
              disabled={isBusy || !apiKey}
            >
              {isBusy ? 'Asking…' : question.title}
            </button>
          );
        })}
      </div>

      {unlockedPresetCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/60">
          <span className="flex-1 border-t border-white/20" />
          <span>referring to a new CT scan</span>
          <span className="flex-1 border-t border-white/20" />
        </div>
      )}

      <div className="ohif-scrollbar mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl bg-[#0b1433] p-4 shadow-inner shadow-black/40">
        {messages.length === 0 ? (
          <div className="border-white/15 rounded-xl border bg-[#0f1c3c] p-3 text-sm text-white/80">
            Select a preset question above to start the conversation.
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === 'user';
            const bubbleClasses = isUser
              ? 'ml-auto bg-[#1f3f8f] text-white'
              : msg.status === 'error'
                ? 'bg-red-600/20 text-red-100'
                : 'bg-[#131f3d] text-white';
            const borderClasses = isUser ? 'border-[#8fb5ff]' : 'border-white/15';
            return (
              <div
                key={msg.id}
                className={`max-w-[80%] rounded-2xl border ${borderClasses} p-3 ${bubbleClasses} shadow-sm shadow-black/40`}
              >
                <p className="text-[11px] uppercase tracking-wide text-white/70">
                  {isUser ? 'You' : 'Assistant'}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{msg.text}</p>
                {msg.status === 'pending' && (
                  <p className="mt-1 text-[11px] text-white/70">Generating…</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatGPTPanel;
