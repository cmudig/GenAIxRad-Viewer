import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useViewportGrid } from '@ohif/ui';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../../platform/app/src/firebase';

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  if (Array.isArray(state.viewports)) {
    return state.viewports;
  }

  if (typeof state.viewports.values === 'function') {
    return Array.from(state.viewports.values());
  }

  if (typeof state.viewports === 'object') {
    return Object.values(state.viewports);
  }

  return [];
};

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
  followups?: string[];
};

type PromptQuestion = {
  id: string;
  title: string;
  prompt: string;
  system_prompt?: string;
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
    title: 'Explain how this slice represents the prompted abnormalities.',
    prompt:
      'Based on the prompt used to generate the CT scan, explain how the slice represents (or does not represent) it.',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
  {
    id: 'counterfactual',
    title: 'Explain if and why this slice does not appear normal.',
    prompt:
      'Analyze this CT slice and provide a description of what visually would need to change for the slice to appear normal.',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
  {
    id: 'mimic',
    title: 'Explain the mimics of the abnormalities in this slice.',
    prompt:
      'Analyze this CT slice and describe what abnormalities may be mistaken for the true impression. Do not provide your impression in the text.',
    system_prompt: BASE_SYSTEM_PROMPT,
  },
];

const extractModelContent = (payload: any): string => {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';
};

const deriveDisplaySetOrigin = (displaySet: any): 'patient' | 'ai' | null => {
  if (!displaySet) {
    return null;
  }

  const explicitOrigin = (displaySet as any).__caseOrigin;
  if (explicitOrigin === 'patient' || explicitOrigin === 'ai') {
    return explicitOrigin;
  }

  const promptChanged =
    displaySet?.SeriesPromptChanged ??
    displaySet?.metadata?.SeriesPromptChanged ??
    displaySet?.getAttribute?.('SeriesPromptChanged') ??
    null;

  if (String(promptChanged).toLowerCase() === 'true') {
    return 'ai';
  }

  return null;
};

const resolveSliceCount = (viewport: any): number | null => {
  if (!viewport) {
    return null;
  }

  const numSlices = viewport.getNumberOfSlices?.();
  if (typeof numSlices === 'number' && numSlices >= 0) {
    return numSlices;
  }

  const imageIds = viewport.getImageIds?.();
  if (Array.isArray(imageIds)) {
    return imageIds.length;
  }

  return null;
};

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

const loadChatState = (
  storageKey: string
): { messages: ChatMessage[]; unlockedPresetCount: number } | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
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

const persistChatState = (
  storageKey: string,
  state: { messages: ChatMessage[]; unlockedPresetCount: number }
) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (err) {
    console.warn('ChatGPTPanel: unable to persist chat state', err);
  }
};

const getSeriesDescription = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }
  const description =
    displaySet.SeriesDescription ??
    displaySet.seriesDescription ??
    displaySet.metadata?.SeriesDescription ??
    displaySet.getAttribute?.('SeriesDescription') ??
    null;
  return typeof description === 'string' && description.trim() ? description.trim() : null;
};

const normalizeStudyIds = (values: string[]): string | null => {
  const ids = values
    .flatMap(value => value.split(/[,;]/))
    .map(value => value.trim())
    .filter(Boolean);
  if (!ids.length) {
    return null;
  }
  return ids.sort().join('|');
};

const getStudyKeyFromLocation = (search: string, hash: string): string | null => {
  const normalizedSearch = search && search.startsWith('?') ? search : search ? `?${search}` : '';
  let hashSearch = '';
  if (hash) {
    const hashIndex = hash.indexOf('?');
    if (hashIndex >= 0) {
      hashSearch = hash.slice(hashIndex);
    }
  }

  const collectValues = (query: string): string[] => {
    if (!query) {
      return [];
    }
    const params = new URLSearchParams(query);
    return [
      ...params.getAll('StudyInstanceUIDs'),
      ...params.getAll('studyInstanceUIDs'),
      ...params.getAll('StudyID'),
      ...params.getAll('studyID'),
      ...params.getAll('studyId'),
    ];
  };

  return normalizeStudyIds([...collectValues(normalizedSearch), ...collectValues(hashSearch)]);
};

const ChatGPTPanel: React.FC<ChatGPTPanelProps> = ({ servicesManager }) => {
  const [{ activeViewportId }] = useViewportGrid();
  const location = useLocation();
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
  const [activeDisplaySetUID, setActiveDisplaySetUID] = useState<string | null>(null);
  const [displaySetNudgeKey, setDisplaySetNudgeKey] = useState(0);
  const lastQAViewportDisplaySetRef = useRef<string | null>(null);
  const lastStudyIdRef = useRef<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const apiKey = config.apiKey ?? storedKey;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const temperature = config.temperature ?? 1;
  const activeStudyKey = useMemo(
    () => getStudyKeyFromLocation(location.search, location.hash),
    [location.search, location.hash]
  );
  const chatStorageKey = useMemo(
    () => (activeStudyKey ? `${CHAT_STATE_KEY}-${activeStudyKey}` : CHAT_STATE_KEY),
    [activeStudyKey]
  );

  const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService ?? null;
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService ||
    null;
  const displaySetService = servicesManager?.services?.displaySetService ?? null;
  const activeDisplaySet = useMemo(() => {
    if (!activeDisplaySetUID || !displaySetService?.getDisplaySetByUID) {
      return null;
    }
    try {
      return displaySetService.getDisplaySetByUID(activeDisplaySetUID);
    } catch {
      return null;
    }
  }, [activeDisplaySetUID, displaySetService]);
  const activeDisplaySetOrigin = useMemo(
    () => deriveDisplaySetOrigin(activeDisplaySet),
    [activeDisplaySet]
  );
  const isAiGenerated = activeDisplaySetOrigin === 'ai';
  const getActiveSliceNote = useCallback((): string | null => {
    if (!cornerstoneViewportService) {
      return null;
    }

    const viewportId = activeViewportId ?? cornerstoneViewportService.getActiveViewportId?.();
    if (!viewportId) {
      return null;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return null;
    }

    const currentIndex = viewport.getCurrentImageIdIndex?.();
    if (!Number.isFinite(currentIndex)) {
      return null;
    }

    const sliceCount = resolveSliceCount(viewport);
    const humanIndex = (currentIndex as number) + 1;

    const seriesDescription = getSeriesDescription(activeDisplaySet);
    const promptNote = seriesDescription
      ? `Prompt used to generate CT Scan: ${seriesDescription}`
      : null;

    const sliceLine =
      sliceCount && sliceCount > 0
        ? `Slice viewed: ${humanIndex}/${sliceCount}`
        : `Slice viewed: ${humanIndex}`;

    return promptNote ? `${sliceLine}\n${promptNote}` : sliceLine;
  }, [activeDisplaySet, activeViewportId, cornerstoneViewportService]);

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

  const resetChatState = useCallback(
    (nextState?: { messages: ChatMessage[]; unlockedPresetCount: number }) => {
      abortInFlight();
      setMessages(nextState?.messages ?? []);
      setUnlockedPresetCount(nextState?.unlockedPresetCount ?? QUESTION_PRESETS.length);
      setBusyQuestionId(null);
      messageCounterRef.current = nextState?.messages.length ?? 0;
      activeQuestionRef.current = null;
    },
    [abortInFlight]
  );

  // Hydrate chat state on first mount
  useEffect(() => {
    if (didHydrateRef.current) {
      return;
    }
    const stored = loadChatState(chatStorageKey);
    if (stored) {
      resetChatState(stored);
    }
    didHydrateRef.current = true;
  }, [chatStorageKey, resetChatState]);

  // Persist chat state when it changes (after initial hydration)
  useEffect(() => {
    if (!didHydrateRef.current) {
      return;
    }
    persistChatState(chatStorageKey, { messages, unlockedPresetCount });
  }, [chatStorageKey, messages, unlockedPresetCount]);

  // Reset Q&A history when the study in the URL changes.
  useEffect(() => {
    const normalizedStudyKey = activeStudyKey ?? '';
    if (lastStudyIdRef.current === null) {
      lastStudyIdRef.current = normalizedStudyKey;
      return;
    }
    if (lastStudyIdRef.current !== normalizedStudyKey) {
      lastStudyIdRef.current = normalizedStudyKey;
      resetChatState(loadChatState(chatStorageKey) ?? undefined);
    }
  }, [activeStudyKey, chatStorageKey, resetChatState]);

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

  // Track the active display set while the Q&A tab is open so we can show a nudge in the chat
  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    const readActiveDisplaySet = () => {
      const state =
        viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const viewports = getViewportsArray(state);
      const activeViewport =
        viewports.find(v => v?.viewportId === activeViewportId) ?? viewports[0] ?? null;
      const uid =
        activeViewport?.displaySetInstanceUIDs?.[0] ||
        activeViewport?.displaySetOptions?.displaySetInstanceUIDs?.[0] ||
        null;

      setActiveDisplaySetUID(uid);
      const lastSeen = lastQAViewportDisplaySetRef.current;
      if (uid && lastSeen && uid !== lastSeen) {
        setDisplaySetNudgeKey(key => key + 1);
      }
      if (uid) {
        lastQAViewportDisplaySetRef.current = uid;
      }
    };

    readActiveDisplaySet();

    const activeSub = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
      readActiveDisplaySet
    );

    const gridSub = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
      readActiveDisplaySet
    );

    return () => {
      activeSub?.unsubscribe?.();
      gridSub?.unsubscribe?.();
    };
  }, [viewportGridService, activeViewportId, displaySetService]);

  const runQuestion = useCallback(
    async (question: PromptQuestion) => {
      abortInFlight();
      setBusyQuestionId(question.id);
      activeQuestionRef.current = question.id;

      if (!isAiGenerated) {
        addMessage({
          role: 'assistant',
          text: 'Q&A is only available on AI-generated CT scans.',
          questionId: question.id,
          status: 'error',
        });
        setBusyQuestionId(null);
        activeQuestionRef.current = null;
        return;
      }

      const sliceNote = getActiveSliceNote();

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
        followups: [],
      });

      let finalAssistantText = '';
      let finalStatus: 'done' | 'error' = 'done';
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

        const seriesDescription =
          question.id === 'describe' ? getSeriesDescription(activeDisplaySet) : null;
        const parts: Array<Record<string, any>> = [
          { text: systemPrompt },
          { text: question.prompt },
        ];
        if (seriesDescription) {
          parts.push({ text: `Prompt used to generate current CT scan: ${seriesDescription}` });
        }
        parts.push({
          inline_data: {
            mime_type: 'image/png',
            data: base64Data,
          },
        });

        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts,
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
        const content = extractModelContent(payload);

        if (!content) {
          throw new Error('Gemini did not return a description.');
        }

        finalAssistantText = sliceNote ? `${content}\n\n${sliceNote}` : content;
        updateMessage(pendingAssistantId, { text: finalAssistantText, status: 'done' });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          updateMessage(pendingAssistantId, { text: 'Request canceled.', status: 'error' });
          return;
        }
        const message = err?.message || 'Unexpected error while contacting Gemini.';
        finalStatus = 'error';
        finalAssistantText = sliceNote ? `${message}\n\n${sliceNote}` : message;
        updateMessage(pendingAssistantId, { text: finalAssistantText, status: 'error' });
      } finally {
        if (finalAssistantText) {
          const seriesDescription =
            question.id === 'describe' ? getSeriesDescription(activeDisplaySet) : null;
          addDoc(collection(db, 'q_and_a'), {
            createdAt: serverTimestamp(),
            questionId: question.id,
            questionTitle: question.title,
            userText: question.title,
            assistantText: finalAssistantText,
            status: finalStatus,
            studyKey: activeStudyKey ?? null,
            displaySetInstanceUID: activeDisplaySetUID ?? null,
            isAiGenerated,
            seriesDescription,
            sliceNote: sliceNote ?? null,
          }).catch(error => {
            console.warn('ChatGPTPanel: failed to log Q&A to Firestore', error);
          });
        }
        controllerRef.current = null;
        if (activeQuestionRef.current === question.id) {
          activeQuestionRef.current = null;
          setBusyQuestionId(null);
        }
      }
    },
    [
      abortInFlight,
      addMessage,
      apiKey,
      captureActiveViewport,
      endpoint,
      getActiveSliceNote,
      isAiGenerated,
      activeDisplaySet,
      activeDisplaySetUID,
      activeStudyKey,
      temperature,
      updateMessage,
    ]
  );

  const askQuestion = useCallback(
    (questionId: string) => {
      const question = QUESTION_PRESETS.find(item => item.id === questionId) ?? QUESTION_PRESETS[0];
      runQuestion(question);
    },
    [runQuestion]
  );

  const firstAssistantIndex = useMemo(
    () => messages.findIndex(msg => msg.role === 'assistant'),
    [messages]
  );
  const shouldShowBanner =
    activeDisplaySetUID && displaySetNudgeKey > 0 && firstAssistantIndex >= 0;
  const renderNewScanBanner = () => (
    <div
      key={`banner-${displaySetNudgeKey}`}
      className="flex items-center gap-2 text-[11px] text-white/60"
      data-cy="new-scan-banner"
    >
      <span className="flex-1 border-t border-white/20" />
      <span>referring to a new CT scan</span>
      <span className="flex-1 border-t border-white/20" />
    </div>
  );

  // Auto-scroll chat to newest message
  useEffect(() => {
    const node = chatContainerRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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

      {!isAiGenerated && (
        <div className="mt-2 rounded-xl border border-white/10 bg-[#0f1c3c] p-3 text-xs text-white/70">
          Q&amp;A is available only when the active viewport shows an AI-generated CT scan.
        </div>
      )}
      {isAiGenerated && (
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
      )}

      <div
        ref={chatContainerRef}
        className="ohif-scrollbar mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl bg-[#0b1433] p-4 shadow-inner shadow-black/40"
      >
        {messages.length === 0 && isAiGenerated ? (
          <div className="border-white/15 rounded-xl border bg-[#0f1c3c] p-3 text-sm text-white/80">
            Select a preset question above to start the conversation.
          </div>
        ) : (
          messages.flatMap((msg, index) => {
            const isUser = msg.role === 'user';
            const bubbleClasses = isUser
              ? 'ml-auto bg-[#1f3f8f] text-white'
              : msg.status === 'error'
                ? 'bg-red-600/20 text-red-100'
                : 'bg-[#131f3d] text-white';
            const borderClasses = isUser ? 'border-[#8fb5ff]' : 'border-white/15';
            const rendered = [
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
              </div>,
            ];

            // Follow-up question feature is paused; skip rendering suggested prompts for now.

            if (shouldShowBanner && index === firstAssistantIndex) {
              rendered.push(renderNewScanBanner());
            }

            return rendered;
          })
        )}
      </div>
    </div>
  );
};

export default ChatGPTPanel;
