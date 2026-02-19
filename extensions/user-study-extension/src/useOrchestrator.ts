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
  sendMessage: (userText: string) => Promise<void>;
  clearThread: () => void;
}

// ─── OpenAI wire types ───────────────────────────────────────────────────────

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: AgentToolName;
    arguments: string;
  };
}

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = 'chatgpt-panel-openai-key'; // shared with ChatGPTPanel
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const ORCHESTRATOR_MODEL = 'gpt-4o';

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an XAI (Explainable AI) orchestration assistant embedded in a medical CT imaging viewer called OHIF. You help radiologists and clinicians explore AI diagnostic decisions for chest CT scans, with a focus on pleural effusion.

You have four tools available:
- similar_cases: Finds and displays CT scans from other patients with similar imaging characteristics or clinical findings. Use when the user asks about similar patients, comparable cases, or wants to see other examples.
- saliency_overlay: Displays a probability-map (PMAP) overlay on the active CT scan highlighting regions most important to the AI diagnosis. Use when the user asks what the AI is looking at, which regions matter, or wants to see attention/heat maps.
- generate_variation: Opens a counterfactual CT generation panel where the user can create a modified version of the current scan (normal vs. abnormal, location, severity). Use when the user wants to see what the scan would look like with different characteristics.
- analyze_slice: Captures the current viewport and sends it to a vision LLM to answer a specific radiology question. Use for any question about the image contents, visible findings, or imaging clues that requires actually looking at the CT slice.

Rules:
1. Call one or more tools based on what the user needs. You may call multiple tools in a single response.
2. For analyze_slice, extract or reformulate the user's question as a clear, focused imaging question to pass as the "question" argument.
3. Keep any prose brief (1-2 sentences max). Prefer tool calls over explanatory text.
4. If the user asks a general greeting or meta question requiring no imaging tool, reply briefly in text only.
5. Do not invent or guess clinical findings — you are a router, not a diagnostician.`;

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'similar_cases',
      description:
        'Find and display CT scans from other patients with similar imaging characteristics or clinical findings to the currently-viewed case. Use when the user asks about similar patients, comparable cases, or wants to see examples of the same pathology.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saliency_overlay',
      description:
        'Display a probability-map saliency overlay on the active CT scan viewport to highlight the image regions most important for the AI diagnosis. Use when the user asks what the AI is looking at, which regions matter, or wants attention/heat maps.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_variation',
      description:
        'Open the counterfactual CT generation panel where the user selects findings, location, and severity to generate a modified CT scan. Use when the user wants to create a variation, change findings, generate a normal scan, or see counterfactual examples.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_slice',
      description:
        'Capture the current CT slice from the active viewport and send it to a vision LLM to answer a specific radiology question. Use for any open-ended question about image contents, visible findings, or imaging clues that requires looking at the CT slice.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'The specific radiology question to ask about the CT slice. Should be clear and focused.',
          },
        },
        required: ['question'],
      },
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const resolveApiKey = async (): Promise<string> => {
  // 1. window.config
  const fromConfig = (window as any)?.config?.chatgptAssistant?.apiKey;
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    return fromConfig.trim();
  }

  // 2. localStorage
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch (_) {}

  // 3. Firestore
  const keyDoc = await getDoc(doc(db, 'api_keys', 'openAI'));
  if (!keyDoc.exists()) {
    throw new Error('OpenAI key is not configured in Firestore.');
  }
  const keyValue = keyDoc.get('key');
  if (typeof keyValue !== 'string' || !keyValue.trim()) {
    throw new Error('Firestore key entry is empty.');
  }
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, keyValue.trim());
  } catch (_) {}
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

  // Wire history for multi-turn context (never includes system prompt — that's prepended each call)
  const wireHistoryRef = useRef<WireMessage[]>([]);

  // Abort controller for in-flight requests
  const controllerRef = useRef<AbortController | null>(null);

  // Cache the resolved API key so we don't hit Firestore on every message
  const apiKeyRef = useRef<string | null>(null);

  const clearThread = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    wireHistoryRef.current = [];
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

  const runAnalyzeSlice = useCallback(
    async (
      question: string,
      apiKey: string,
      messageId: string,
      signal: AbortSignal
    ): Promise<string> => {
      // Capture the viewport image
      const dataUrl = await captureActiveViewport(servicesManager, activeViewportId);

      const response = await fetch(DEFAULT_ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
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
        let message = `OpenAI request failed (status ${response.status})`;
        try {
          const payload = await response.json();
          if (payload?.error?.message) {
            message = payload.error.message;
          }
        } catch (_) {}
        throw new Error(message);
      }

      const payload = await response.json();
      const content =
        payload?.choices?.[0]?.message?.content ?? payload?.data?.[0]?.content ?? '';

      if (!content) {
        throw new Error('OpenAI did not return a description.');
      }

      return content as string;
    },
    [servicesManager, activeViewportId]
  );

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isThinking) {
        return;
      }

      // Abort any in-flight request
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

      // 2. Append to wire history
      wireHistoryRef.current = [
        ...wireHistoryRef.current,
        { role: 'user', content: userText.trim() },
      ];

      setIsThinking(true);

      try {
        // 3. Resolve API key (cached after first call)
        if (!apiKeyRef.current) {
          apiKeyRef.current = await resolveApiKey();
        }
        const apiKey = apiKeyRef.current;

        // 4. Call orchestrator
        const response = await fetch(DEFAULT_ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: ORCHESTRATOR_MODEL,
            temperature: 0,
            tool_choice: 'auto',
            tools: AGENT_TOOLS,
            messages: [
              { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
              ...wireHistoryRef.current,
            ],
          }),
        });

        if (!response.ok) {
          let message = `Orchestrator request failed (${response.status})`;
          try {
            const payload = await response.json();
            if (payload?.error?.message) message = payload.error.message;
          } catch (_) {}
          throw new Error(message);
        }

        const data = await response.json();
        const assistantMsg = data?.choices?.[0]?.message;

        if (!assistantMsg) {
          throw new Error('Empty response from orchestrator.');
        }

        // 5. Add assistant message to wire history
        wireHistoryRef.current = [...wireHistoryRef.current, assistantMsg];

        // 6. Optional orchestrator prose
        if (assistantMsg.content) {
          const orchMsg: OrchestratorMessage = {
            id: makeId(),
            role: 'orchestrator',
            content: assistantMsg.content,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, orchMsg]);
        }

        const toolCalls: OpenAIToolCall[] = assistantMsg.tool_calls ?? [];

        if (toolCalls.length === 0) {
          // Orchestrator responded with prose only — nothing more to do
          setIsThinking(false);
          return;
        }

        // 7. Fire reset events so embedded components start fresh
        document.dispatchEvent(new CustomEvent('examplesReset'));
        document.dispatchEvent(
          new CustomEvent('tabChanged', { detail: { tab: 'assistant' } })
        );

        // 8. Create pending agent messages for all tool calls at once
        const pendingAgentMsgs: AgentMessage[] = toolCalls.map(tc => {
          const name = tc.function.name;
          const base = {
            id: makeId(),
            role: 'agent' as const,
            toolCallId: tc.id,
            userMessageId: userMsgId,
            timestamp: Date.now(),
          };

          if (name === 'analyze_slice') {
            let question = 'Analyze this CT slice.';
            try {
              const args = JSON.parse(tc.function.arguments || '{}');
              if (typeof args.question === 'string' && args.question.trim()) {
                question = args.question.trim();
              }
            } catch (_) {}

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

        // 9. Resolve each agent concurrently
        const toolResults: WireMessage[] = [];

        await Promise.allSettled(
          pendingAgentMsgs.map(async agentMsg => {
            if (agentMsg.kind === 'component') {
              // Component agents are self-sufficient — flip to ready immediately
              updateAgentMessage(agentMsg.id, { status: 'ready' });
              toolResults.push({
                role: 'tool',
                tool_call_id: agentMsg.toolCallId,
                content: 'Panel rendered successfully.',
              });
            } else {
              // analyze_slice: run vision API call
              try {
                const answer = await runAnalyzeSlice(
                  agentMsg.question,
                  apiKey,
                  agentMsg.id,
                  controller.signal
                );
                updateAgentMessage(agentMsg.id, { status: 'done', content: answer });
                toolResults.push({
                  role: 'tool',
                  tool_call_id: agentMsg.toolCallId,
                  content: answer,
                });
              } catch (err: any) {
                if (err?.name === 'AbortError') return;
                const msg = err?.message || 'Vision API call failed.';
                updateAgentMessage(agentMsg.id, { status: 'error', errorMessage: msg });
                toolResults.push({
                  role: 'tool',
                  tool_call_id: agentMsg.toolCallId,
                  content: `Error: ${msg}`,
                });
              }
            }
          })
        );

        // 10. Append tool results to wire history for future turns
        wireHistoryRef.current = [...wireHistoryRef.current, ...toolResults];
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const msg = err?.message || 'Unexpected error contacting OpenAI.';
        setError(msg);
        setIsThinking(false);
        // Also clear the cached key if it's an auth error so it re-fetches next time
        if (msg.includes('401') || msg.toLowerCase().includes('api key')) {
          apiKeyRef.current = null;
          try {
            window.localStorage.removeItem(LOCAL_STORAGE_KEY);
          } catch (_) {}
        }
      }
    },
    [isThinking, runAnalyzeSlice, updateAgentMessage]
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
