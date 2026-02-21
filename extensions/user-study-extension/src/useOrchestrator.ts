import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewportGrid } from '@ohif/ui';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../platform/app/src/firebase';
import { captureActiveViewport } from './utils/captureViewport';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentToolName =
  | 'similar_cases'
  | 'saliency_overlay'
  | 'generate_variation'
  | 'analyze_slice';

export type ComponentAgentName = 'similar_cases' | 'saliency_overlay' | 'generate_variation';

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  timestamp: number;
}

export interface OrchestratorMessage {
  id: string;
  role: 'orchestrator';
  content: string | null;
  timestamp: number;
}

export interface ComponentAgentMessage {
  id: string;
  role: 'agent';
  kind: 'component';
  agentName: ComponentAgentName;
  toolCallId: string;
  userMessageId: string;
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  timestamp: number;
}

export interface TextAgentMessage {
  id: string;
  role: 'agent';
  kind: 'text';
  agentName: 'analyze_slice';
  toolCallId: string;
  userMessageId: string;
  status: 'loading' | 'done' | 'error';
  content: string;
  question: string;
  errorMessage?: string;
  timestamp: number;
}

export type AgentMessage = ComponentAgentMessage | TextAgentMessage;
export type ChatMessage = UserMessage | OrchestratorMessage | AgentMessage;

export interface OrchestratorState {
  messages: ChatMessage[];
  isThinking: boolean;
  error: string | null;
}

export interface UseOrchestratorReturn {
  state: OrchestratorState;
  sendMessage: (userText: string, directAgent?: AgentToolName) => Promise<void>;
  clearThread: () => void;
}

// ─── Gemini wire types ────────────────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: { content: string } } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OPENAI_LOCAL_STORAGE_KEY = 'chatgpt-panel-openai-key';
const GEMINI_LOCAL_STORAGE_KEY = 'gemini-api-key';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_VISION_MODEL = 'gpt-4o';

const GEMINI_MODEL = 'gemini-2.0-flash';

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an XAI (Explainable AI) orchestration assistant embedded in a medical CT imaging viewer called OHIF. You help medical students and clinicians explore AI diagnostic decisions for chest CT scans, with a focus on pleural effusion.

You have four tools available:
- similar_cases: Finds and displays CT scans from other patients with similar imaging characteristics or clinical findings. Use when the user asks about similar patients, comparable cases, or wants to see other examples.
- saliency_overlay: Displays a probability-map (PMAP) overlay on the active CT scan highlighting regions most important to the AI diagnosis. Use when the user asks what the AI is looking at, which regions matter, or wants to see attention/heat maps/heat maps.
- generate_variation: Opens a counterfactual CT generation panel where the user can create a modified version of the current scan (normal vs. abnormal, location, severity). Use when the user wants to generate a comparison scan, see a variation, or explore counterfactuals.
- analyze_slice: Captures the current viewport and sends it to a vision LLM to answer a specific radiology question. Use for any question about the image contents, visible findings, or imaging clues that requires actually looking at the CT slice.

Rules:
1. Call one or more tools based on what the user needs. You may call multiple tools in a single response.
2. For analyze_slice, extract or reformulate the user's question as a clear, focused imaging question to pass as the "question" argument.
3. Be warm, educational, and conversational. You can respond with natural language alongside tool calls.
4. If the user asks a general greeting or meta question requiring no imaging tool, reply in text only.
5. Do not invent or guess clinical findings — you are a router and assistant, not a diagnostician.`;

const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: 'similar_cases',
    description:
      'Find and display CT scans from other patients with similar imaging characteristics or clinical findings. Use when the user asks about similar patients, comparable cases, or wants to see examples of the same pathology.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'saliency_overlay',
    description:
      'Display a probability-map saliency overlay on the active CT scan to highlight the image regions most important for the AI diagnosis. Use when the user asks what the AI is looking at, which regions matter, or wants attention/heat maps.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generate_variation',
    description:
      'Open the counterfactual CT generation panel where the user selects findings, location, and severity to generate a modified CT scan. Use when the user wants to create a variation, generate a comparison scan, or see counterfactual examples.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'analyze_slice',
    description:
      'Capture the current CT slice from the active viewport and send it to a vision LLM to answer a specific radiology question. Use for any open-ended question about image contents, visible findings, or imaging clues that requires looking at the CT slice.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The specific radiology question to ask about the CT slice. Should be clear and focused.',
        },
      },
      required: ['question'],
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const resolveOpenAIKey = async (): Promise<string> => {
  const fromConfig = (window as any)?.config?.chatgptAssistant?.apiKey;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();

  try {
    const stored = window.localStorage.getItem(OPENAI_LOCAL_STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch (_) {}

  const keyDoc = await getDoc(doc(db, 'api_keys', 'openAI'));
  if (!keyDoc.exists()) throw new Error('OpenAI key is not configured in Firestore.');
  const keyValue = keyDoc.get('key');
  if (typeof keyValue !== 'string' || !keyValue.trim()) throw new Error('OpenAI key entry is empty.');
  try { window.localStorage.setItem(OPENAI_LOCAL_STORAGE_KEY, keyValue.trim()); } catch (_) {}
  return keyValue.trim();
};

const resolveGeminiKey = async (): Promise<string> => {
  const fromConfig = (window as any)?.config?.geminiApiKey;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();

  try {
    const stored = window.localStorage.getItem(GEMINI_LOCAL_STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch (_) {}

  const keyDoc = await getDoc(doc(db, 'api_keys', 'gemini'));
  if (!keyDoc.exists()) throw new Error('Gemini API key is not configured in Firestore (api_keys/gemini).');
  const keyValue = keyDoc.get('key');
  if (typeof keyValue !== 'string' || !keyValue.trim()) throw new Error('Gemini key entry is empty.');
  try { window.localStorage.setItem(GEMINI_LOCAL_STORAGE_KEY, keyValue.trim()); } catch (_) {}
  return keyValue.trim();
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOrchestrator({
  servicesManager,
}: {
  servicesManager: any;
}): UseOrchestratorReturn {
  const [{ activeViewportId }] = useViewportGrid();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gemini wire history for multi-turn context
  const geminiHistoryRef = useRef<GeminiContent[]>([]);

  const controllerRef = useRef<AbortController | null>(null);
  const openAIKeyRef = useRef<string | null>(null);
  const geminiKeyRef = useRef<string | null>(null);

  const clearThread = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    geminiHistoryRef.current = [];
    setMessages([]);
    setIsThinking(false);
    setError(null);
  }, []);

  const updateAgentMessage = useCallback(
    (id: string, patch: Partial<AgentMessage>) => {
      setMessages(prev =>
        prev.map(m => (m.id === id && m.role === 'agent' ? { ...m, ...patch } : m))
      );
    },
    []
  );

  // ── OpenAI vision call (analyze_slice stays on GPT-4o) ────────────────────
  const runAnalyzeSlice = useCallback(
    async (
      question: string,
      apiKey: string,
      _messageId: string,
      signal: AbortSignal
    ): Promise<string> => {
      const dataUrl = await captureActiveViewport(servicesManager, activeViewportId);

      const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_VISION_MODEL,
          temperature: 1,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert radiology assistant, with expertise in identifying pleural effusion. Remember that the right and left sides are flipped in CT images. Describe only the imaging abnormalities you can see in the format of an impression. If the slice is normal, explicitly state that no abnormalities are visible. Do not provide more than 5 sentences of information.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        let message = `OpenAI vision request failed (${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.error?.message) message = payload.error.message;
        } catch (_) {}
        throw new Error(message);
      }

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('OpenAI did not return a description.');
      return content as string;
    },
    [servicesManager, activeViewportId]
  );

  // ── Direct agent bypass (no LLM round-trip) ───────────────────────────────
  const fireDirectAgent = useCallback(
    async (
      userText: string,
      userMsgId: string,
      agentName: AgentToolName,
      signal: AbortSignal,
      openAIKey: string
    ) => {
      document.dispatchEvent(new CustomEvent('examplesReset'));
      document.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: 'assistant' } }));

      const base = {
        id: makeId(),
        role: 'agent' as const,
        toolCallId: makeId(),
        userMessageId: userMsgId,
        timestamp: Date.now(),
      };

      if (agentName === 'analyze_slice') {
        const question = userText.trim() || 'Analyze this CT slice.';
        const agentMsg: TextAgentMessage = {
          ...base,
          kind: 'text' as const,
          agentName: 'analyze_slice' as const,
          status: 'loading' as const,
          content: '',
          question,
        };
        setMessages(prev => [...prev, agentMsg]);
        setIsThinking(false);
        try {
          const answer = await runAnalyzeSlice(question, openAIKey, agentMsg.id, signal);
          updateAgentMessage(agentMsg.id, { status: 'done', content: answer });
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          updateAgentMessage(agentMsg.id, {
            status: 'error',
            errorMessage: err?.message ?? 'Vision call failed.',
          });
        }
      } else {
        const agentMsg: ComponentAgentMessage = {
          ...base,
          kind: 'component' as const,
          agentName: agentName as ComponentAgentName,
          status: 'ready' as const,
        };
        setMessages(prev => [...prev, agentMsg]);
        setIsThinking(false);
      }
    },
    [runAnalyzeSlice, updateAgentMessage]
  );

  // ── Main sendMessage ───────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (userText: string, directAgent?: AgentToolName) => {
      if ((!userText.trim() && !directAgent) || isThinking) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setError(null);

      // 1. Append user message to UI
      const userMsgId = makeId();
      const userMsg: UserMessage = {
        id: userMsgId,
        role: 'user',
        content: userText.trim(),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg]);

      // 2. Append to Gemini history
      geminiHistoryRef.current = [
        ...geminiHistoryRef.current,
        { role: 'user', parts: [{ text: userText.trim() }] },
      ];

      setIsThinking(true);

      try {
        // 3. Resolve OpenAI key (always needed for analyze_slice vision calls)
        if (!openAIKeyRef.current) {
          openAIKeyRef.current = await resolveOpenAIKey();
        }
        const openAIKey = openAIKeyRef.current;

        // ── Direct agent bypass ────────────────────────────────────────────
        if (directAgent) {
          await fireDirectAgent(userText.trim(), userMsgId, directAgent, controller.signal, openAIKey);
          return;
        }

        // ── Gemini orchestration ───────────────────────────────────────────
        if (!geminiKeyRef.current) {
          geminiKeyRef.current = await resolveGeminiKey();
        }
        const geminiKey = geminiKeyRef.current;

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;

        const response = await fetch(geminiEndpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: geminiHistoryRef.current,
            tools: [{ function_declarations: GEMINI_FUNCTION_DECLARATIONS }],
            system_instruction: { parts: [{ text: ORCHESTRATOR_SYSTEM_PROMPT }] },
            generation_config: { temperature: 0 },
          }),
        });

        if (!response.ok) {
          let message = `Gemini request failed (${response.status})`;
          try {
            const payload = await response.json();
            if (payload?.error?.message) message = payload.error.message;
          } catch (_) {}
          throw new Error(message);
        }

        const data = await response.json();
        const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];

        if (parts.length === 0) throw new Error('Empty response from Gemini.');

        // 4. Add model response to Gemini history
        geminiHistoryRef.current = [
          ...geminiHistoryRef.current,
          { role: 'model', parts },
        ];

        // 5. Extract text and function calls from parts
        const textContent = parts
          .filter((p): p is { text: string } => 'text' in p)
          .map(p => p.text)
          .join('');

        const functionCalls = parts
          .filter(
            (p): p is { functionCall: { name: string; args: Record<string, any> } } =>
              'functionCall' in p
          )
          .map(p => p.functionCall);

        // 6. Show orchestrator prose if present
        if (textContent.trim()) {
          const orchMsg: OrchestratorMessage = {
            id: makeId(),
            role: 'orchestrator',
            content: textContent.trim(),
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, orchMsg]);
        }

        if (functionCalls.length === 0) {
          setIsThinking(false);
          return;
        }

        // 7. Fire reset events so embedded components start fresh
        document.dispatchEvent(new CustomEvent('examplesReset'));
        document.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: 'assistant' } }));

        // 8. Create pending agent messages for all function calls
        const pendingAgentMsgs: AgentMessage[] = functionCalls.map(fc => {
          const name = fc.name as AgentToolName;
          const base = {
            id: makeId(),
            role: 'agent' as const,
            toolCallId: makeId(),
            userMessageId: userMsgId,
            timestamp: Date.now(),
          };

          if (name === 'analyze_slice') {
            const question =
              typeof fc.args?.question === 'string' && fc.args.question.trim()
                ? fc.args.question.trim()
                : 'Analyze this CT slice.';
            return {
              ...base,
              kind: 'text' as const,
              agentName: 'analyze_slice' as const,
              status: 'loading' as const,
              content: '',
              question,
            };
          }

          return {
            ...base,
            kind: 'component' as const,
            agentName: name as ComponentAgentName,
            status: 'loading' as const,
          };
        });

        setMessages(prev => [...prev, ...pendingAgentMsgs]);
        setIsThinking(false);

        // 9. Resolve each agent concurrently, collect tool results
        const toolResultParts: GeminiPart[] = [];

        await Promise.allSettled(
          pendingAgentMsgs.map(async agentMsg => {
            if (agentMsg.kind === 'component') {
              updateAgentMessage(agentMsg.id, { status: 'ready' });
              toolResultParts.push({
                functionResponse: {
                  name: agentMsg.agentName,
                  response: { content: 'Panel rendered successfully.' },
                },
              });
            } else {
              try {
                const answer = await runAnalyzeSlice(
                  agentMsg.question,
                  openAIKey,
                  agentMsg.id,
                  controller.signal
                );
                updateAgentMessage(agentMsg.id, { status: 'done', content: answer });
                toolResultParts.push({
                  functionResponse: {
                    name: 'analyze_slice',
                    response: { content: answer },
                  },
                });
              } catch (err: any) {
                if (err?.name === 'AbortError') return;
                const msg = err?.message || 'Vision API call failed.';
                updateAgentMessage(agentMsg.id, { status: 'error', errorMessage: msg });
                toolResultParts.push({
                  functionResponse: {
                    name: 'analyze_slice',
                    response: { content: `Error: ${msg}` },
                  },
                });
              }
            }
          })
        );

        // 10. Append all tool results as a single user turn in Gemini history
        if (toolResultParts.length > 0) {
          geminiHistoryRef.current = [
            ...geminiHistoryRef.current,
            { role: 'user', parts: toolResultParts },
          ];
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const msg = err?.message || 'Unexpected error.';
        setError(msg);
        setIsThinking(false);
        if (msg.includes('401') || msg.toLowerCase().includes('api key')) {
          geminiKeyRef.current = null;
          try { window.localStorage.removeItem(GEMINI_LOCAL_STORAGE_KEY); } catch (_) {}
        }
      }
    },
    [isThinking, runAnalyzeSlice, updateAgentMessage, fireDirectAgent]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return {
    state: { messages, isThinking, error },
    sendMessage,
    clearThread,
  };
}
