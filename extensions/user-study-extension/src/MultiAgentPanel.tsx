import React, { useCallback, useEffect, useRef, useState } from 'react';
import ExampleComponent from './ExampleComponent';
import OverlayComponent from './OverlayComponent';
import VariationPanel from './tabs/VariationPanel';
import {
  useOrchestrator,
  type AgentToolName,
  type ComponentAgentMessage,
  type TextAgentMessage,
  type ChatMessage,
  type ComponentAgentName,
} from './useOrchestrator';

// ─── Agent metadata ───────────────────────────────────────────────────────────

const AGENT_LABELS: Record<AgentToolName, string> = {
  similar_cases: 'Similar Cases',
  saliency_overlay: 'Important Regions',
  generate_variation: 'Variations',
  analyze_slice: 'Q&A',
};

// Simple text icons (no emoji per project convention)
const AGENT_ICONS: Record<AgentToolName, string> = {
  similar_cases: '[~]',
  saliency_overlay: '[*]',
  generate_variation: '[+]',
  analyze_slice: '[?]',
};

const AGENT_COMPONENTS: Record<ComponentAgentName, React.ComponentType<any>> = {
  similar_cases: ExampleComponent,
  saliency_overlay: OverlayComponent,
  generate_variation: VariationPanel,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const AgentCardHeader: React.FC<{
  agentName: AgentToolName;
  hasError?: boolean;
}> = ({ agentName, hasError }) => (
  <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-3">
    <span className="font-mono text-xs text-white/40">{AGENT_ICONS[agentName]}</span>
    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
      {AGENT_LABELS[agentName]}
    </span>
    {hasError && <span className="ml-auto text-[10px] text-red-400">Error</span>}
  </div>
);

const UserBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex justify-end">
    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#1a2d6d] px-4 py-3 text-sm text-white leading-relaxed">
      {content}
    </div>
  </div>
);

const OrchestratorBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex justify-start">
    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-[#0b1433] px-4 py-3 text-sm text-white/70 italic leading-relaxed">
      {content}
    </div>
  </div>
);

const ComponentAgentCard: React.FC<
  ComponentAgentMessage & {
    commandsManager: any;
    servicesManager: any;
    extensionManager: any;
  }
> = ({ agentName, userMessageId, status, errorMessage, commandsManager, servicesManager, extensionManager }) => {
  const EmbeddedComponent = AGENT_COMPONENTS[agentName as ComponentAgentName];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1433] overflow-hidden">
      <div className="px-4 pt-4">
        <AgentCardHeader agentName={agentName} hasError={status === 'error'} />
      </div>

      {status === 'loading' && (
        <div className="px-4 pb-4">
          <p className="text-sm text-white/50">Loading...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="px-4 pb-4">
          <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{errorMessage}</p>
        </div>
      )}

      {status === 'ready' && EmbeddedComponent && (
        <div className="min-h-[200px]">
          {/* key includes userMessageId so each new conversation turn remounts fresh */}
          <EmbeddedComponent
            key={`${agentName}-${userMessageId}`}
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
          />
        </div>
      )}
    </div>
  );
};

const TextAgentCard: React.FC<TextAgentMessage> = ({
  agentName,
  question,
  status,
  content,
  errorMessage,
}) => (
  <div className="rounded-2xl border border-white/10 bg-[#0b1433] p-4">
    <AgentCardHeader agentName={agentName} hasError={status === 'error'} />
    <p className="text-xs text-white/40 italic mb-3">&ldquo;{question}&rdquo;</p>

    {status === 'loading' && (
      <p className="text-sm text-white/50">Capturing slice and consulting AI...</p>
    )}
    {(status === 'done') && content && (
      <p className="rounded-xl bg-[#0e1c4a] p-3 text-sm leading-relaxed text-white">
        {content}
      </p>
    )}
    {status === 'error' && (
      <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{errorMessage}</p>
    )}
  </div>
);

const ThinkingIndicator: React.FC = () => (
  <div className="flex justify-start">
    <div className="rounded-2xl rounded-bl-sm bg-[#0b1433] px-4 py-3">
      <div className="flex gap-1 items-center h-4">
        <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  </div>
);

const SUGGESTIONS = [
  { text: 'Show me similar diagnosed cases', hint: 'Compare against known presentations' },
  { text: "What regions drove the AI's prediction?", hint: 'Understand where the AI focused' },
  { text: 'What would this look like without the finding?', hint: 'Explore a counterfactual scan' },
  { text: "What's the main finding on this slice?", hint: 'Get an AI read of the current view' },
];

const WORKFLOW_STEPS = [
  { step: '1', label: 'Form a hypothesis', desc: 'Examine the scan yourself and note what you think the finding is.' },
  { step: '2', label: 'Compare & investigate', desc: 'Use Similar Cases or Important Regions to check your read against known examples and AI attention.' },
  { step: '3', label: 'Challenge it', desc: 'Generate a counterfactual — see what the scan looks like without the finding.' },
  { step: '4', label: 'Ask specific questions', desc: 'Use Visual Q&A to probe anything about this specific slice.' },
];

const AGENT_DESCRIPTIONS = [
  { name: 'Similar Cases', desc: 'Finds real cases with matching features for side-by-side comparison.' },
  { name: 'Important Regions', desc: 'Shows which areas the AI weighted most heavily in its prediction.' },
  { name: 'Variations', desc: 'Generates a counterfactual scan — the same patient, without the finding.' },
  { name: 'Visual Q&A', desc: 'Answers free-form questions about the current CT slice using vision AI.' },
];

const HelpPopover: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex items-center justify-center w-4 h-4 rounded-full border border-white/20
                   text-[9px] text-white/40 hover:text-white/70 hover:border-white/40 transition"
        aria-label="How to use this panel"
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-72 rounded-xl border border-white/15 bg-[#0d1940] shadow-2xl p-4 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-white/80 mb-2.5">Suggested learning workflow</p>
            <div className="space-y-2.5">
              {WORKFLOW_STEPS.map(({ step, label, desc }) => (
                <div key={step} className="flex gap-2.5">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-white/10 text-[9px] text-white/50 flex items-center justify-center mt-0.5">
                    {step}
                  </span>
                  <div>
                    <p className="text-[11px] font-medium text-white/70 leading-tight">{label}</p>
                    <p className="text-[10px] text-white/35 leading-snug mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/10 pt-3">
            <p className="text-[11px] font-semibold text-white/80 mb-2">What each agent does</p>
            <div className="space-y-2">
              {AGENT_DESCRIPTIONS.map(({ name, desc }) => (
                <div key={name}>
                  <p className="text-[10px] font-medium text-white/60">{name}</p>
                  <p className="text-[10px] text-white/30 leading-snug">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ onSuggestion: (text: string) => void }> = ({ onSuggestion }) => (
  <div className="flex flex-col gap-3 px-1 py-6">
    <div>
      <p className="text-xs font-semibold text-white/70">Where would you like to start?</p>
      <p className="text-[11px] text-white/35 mt-0.5 leading-snug">
        Select a starting point or type your own question below.
      </p>
    </div>
    <div className="flex flex-col gap-2 w-full">
      {SUGGESTIONS.map(({ text, hint }) => (
        <button
          key={text}
          onClick={() => onSuggestion(text)}
          className="rounded-xl border border-white/10 bg-[#0b1433] px-3 py-2.5 text-left
                     hover:border-white/30 hover:bg-white/5 transition group"
        >
          <p className="text-xs text-white/70 group-hover:text-white/90 transition leading-snug">{text}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{hint}</p>
        </button>
      ))}
    </div>
  </div>
);

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div className="mx-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
    {message}
  </div>
);

// ─── Message renderer ─────────────────────────────────────────────────────────

const MessageRenderer: React.FC<{
  message: ChatMessage;
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
}> = ({ message, commandsManager, servicesManager, extensionManager }) => {
  if (message.role === 'user') {
    return <UserBubble content={message.content} />;
  }

  if (message.role === 'orchestrator') {
    return message.content ? <OrchestratorBubble content={message.content} /> : null;
  }

  if (message.role === 'agent') {
    if (message.kind === 'component') {
      return (
        <ComponentAgentCard
          {...message}
          commandsManager={commandsManager}
          servicesManager={servicesManager}
          extensionManager={extensionManager}
        />
      );
    }
    return <TextAgentCard {...message} />;
  }

  return null;
};

// ─── Root panel ───────────────────────────────────────────────────────────────

type MultiAgentPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
};

function MultiAgentPanel({ commandsManager, servicesManager, extensionManager }: MultiAgentPanelProps) {
  const { state, sendMessage, clearThread } = useOrchestrator({ servicesManager });

  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, state.isThinking]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || state.isThinking) return;
    setInputText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await sendMessage(text);
  }, [inputText, state.isThinking, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
  };

  const handleSuggestion = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage]
  );

  return (
    <div className="ohif-scrollbar flex h-full flex-col bg-[#050c24] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-white leading-tight">Explainability Agent System</p>
              <HelpPopover />
            </div>
            <p className="text-[11px] text-white/50 mt-0.5 leading-snug">
              Four specialized AI agents working together
            </p>
          </div>
          {state.messages.length > 0 && (
            <button
              onClick={clearThread}
              className="rounded-full px-3 py-1 text-xs text-white/40 hover:text-white/70 transition border border-white/10 hover:border-white/30 shrink-0 ml-2"
            >
              Clear
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {[
            { label: 'Similar Cases', technique: 'Exemplar-Based' },
            { label: 'Saliency Maps', technique: 'Attention-Based' },
            { label: 'Variations', technique: 'Counterfactual' },
            { label: 'Visual Q&A', technique: 'Reasoning-Based' },
          ].map(({ label, technique }) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-white/80 leading-tight">{label}</p>
              <p className="text-[9px] text-white/35 uppercase tracking-widest mt-0.5">{technique}</p>
            </div>
          ))}
        </div>

        <p className="mt-2.5 text-[10px] text-white/30 leading-relaxed">
          Ask a question — the orchestrator routes to the right agent automatically
        </p>
      </div>

      {/* Message thread */}
      <div
        ref={scrollRef}
        className="ohif-scrollbar flex-1 overflow-y-auto min-h-0 space-y-4 p-4"
      >
        {state.messages.length === 0 && !state.isThinking && (
          <EmptyState onSuggestion={handleSuggestion} />
        )}

        {state.messages.map(msg => (
          <MessageRenderer
            key={msg.id}
            message={msg}
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
          />
        ))}

        {state.isThinking && <ThinkingIndicator />}

        {state.error && <ErrorBanner message={state.error} />}
      </div>

      {/* Input area */}
      <div className="border-t border-white/10 p-3 shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#0b1433] p-2">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g. 'Is this finding significant?' or 'Show me a case without the lesion'"
            rows={1}
            className="ohif-scrollbar flex-1 resize-none bg-transparent text-sm text-white
                       placeholder-white/30 focus:outline-none leading-relaxed px-2 py-1"
            style={{ maxHeight: '128px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || state.isThinking}
            className="shrink-0 rounded-full bg-primary-main px-4 py-2 text-xs font-semibold
                       text-black transition hover:bg-primary-light
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.isThinking ? 'Thinking...' : 'Send'}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/25">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

export default MultiAgentPanel;
