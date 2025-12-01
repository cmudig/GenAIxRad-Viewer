import React, { useCallback, useRef, useState, useMemo } from 'react';
import { useViewportGrid } from '@ohif/ui';

type OllamaPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

type AssistantConfig = {
  endpoint?: string;
  model?: string;
  temperature?: number;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'gemma3:latest';

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

  const rawConfig = (window as any)?.config?.ollamaAssistant;

  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const { endpoint, model, temperature } = rawConfig;

  return {
    endpoint: typeof endpoint === 'string' ? endpoint : undefined,
    model: typeof model === 'string' ? model : undefined,
    temperature: typeof temperature === 'number' ? temperature : undefined,
  };
};

const OllamaPanel: React.FC<OllamaPanelProps> = ({ servicesManager }) => {
  const [{ activeViewportId }] = useViewportGrid();
  const config = useMemo(() => readConfig(), []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const endpoint = config.endpoint ?? DEFAULT_OLLAMA_ENDPOINT;
  const model = config.model ?? DEFAULT_MODEL;
  const temperature = config.temperature ?? 0.7;

  const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService ?? null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      console.warn('OllamaPanel: failed to read canvas', err);
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

  const sendMessage = useCallback(
    async (userMessage: string) => {
      if (!userMessage.trim()) return;

      abortInFlight();
      setConnectionError('');

      // Add user message
      const userMessageId = `msg-${Date.now()}`;
      setMessages(prev => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          content: userMessage,
          timestamp: Date.now(),
        },
      ]);
      setInputValue('');
      setIsLoading(true);

      try {
        const dataUrl = await captureActiveViewport();

        const controller = new AbortController();
        controllerRef.current = controller;

        const response = await fetch(endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt: userMessage,
            stream: false,
            temperature,
            system:
              'You are an expert radiology assistant, with expertise in identifying pleural effusion. Remember that the right and left sides are flipped in CT scans and medical images. Do not provide more than 5 sentences of information. Answer the users question.',
            images: [dataUrl.split(',')[1]], // Base64 without data URL prefix
          }),
        });

        if (!response.ok) {
          let message = `Ollama request failed (status ${response.status})`;
          try {
            const payload = await response.json();
            if (payload?.error) {
              message = payload.error;
            }
          } catch (err) {
            // Swallow parsing errors
          }
          throw new Error(message);
        }

        const payload = await response.json();
        const content = payload?.response ?? '';

        if (!content) {
          throw new Error('Ollama did not return a description.');
        }

        // Add assistant response
        setMessages(prev => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content,
            timestamp: Date.now(),
          },
        ]);
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }

        const message = err?.message || 'Unexpected error while contacting Ollama.';

        // Check if it's a connection error
        if (err?.message?.includes('Failed to fetch') || err?.message?.includes('network')) {
          setConnectionError(
            `Cannot connect to Ollama at ${endpoint}. Ensure Ollama is running and the endpoint is correct.`
          );
        }

        setMessages(prev => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${message}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        controllerRef.current = null;
        setIsLoading(false);
      }
    },
    [abortInFlight, captureActiveViewport, endpoint, model, temperature]
  );

  const handlePresetClick = (title: string) => {
    sendMessage(title);
  };

  return (
    <div className="flex h-full flex-col text-white bg-gradient-to-b from-[#0a0e27] to-[#0d1b3d]">
      {/* Header */}
      <div className="border-b border-white/10 p-4">
        <h2 className="text-xl font-semibold">Q&A</h2>
        <p className="text-sm text-white/60">Ask AI about the currently-viewing slice.</p>
      </div>

      {/* Connection Error */}
      {connectionError && (
        <div className="mx-4 mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300 border border-red-500/20">
          {connectionError}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-white/50 text-sm">No messages yet. Start by asking a question.</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-none'
                    : 'bg-[#1a2847] text-white/90 rounded-bl-none'
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#1a2847] text-white/70 px-4 py-2 rounded-lg rounded-bl-none text-sm">
              <p>Thinking…</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Presets Section */}
      {messages.length === 0 && (
        <div className="border-t border-white/10 p-4 space-y-2">
          <p className="text-xs text-white/50 uppercase tracking-wide">Suggested Questions</p>
          <div className="flex flex-col gap-2">
            {QUESTION_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset.title)}
                disabled={isLoading}
                className="text-left px-3 py-2 rounded-full bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/30"
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-white/10 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyPress={e => {
              if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                sendMessage(inputValue);
              }
            }}
            placeholder="Enter your question…"
            disabled={isLoading}
            className="flex-1 bg-[#1a2847] border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={() => sendMessage(inputValue)}
            disabled={isLoading || !inputValue.trim()}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/40 rounded-full px-6 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
};

export default OllamaPanel;
