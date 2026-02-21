import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ExampleComponent from './ExampleComponent';
import OverlayComponent from './OverlayComponent';
import VariationPanel from './tabs/VariationPanel';
import {
  useOrchestrator,
  type AgentToolName,
  type AgentMessage,
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

// ─── Header tile info (with per-agent help text) ──────────────────────────────

const AGENT_TILE_INFO = [
  {
    label: 'Similar Cases',
    technique: 'Exemplar-Based',
    key: 'similar_cases' as AgentToolName,
    desc: 'Finds real CT cases with matching AI-detected features for side-by-side comparison.',
    when: 'Use to validate your hypothesis against known presentations.',
    requiresScan: false,
  },
  {
    label: 'Saliency Maps',
    technique: 'Attention-Based',
    key: 'saliency_overlay' as AgentToolName,
    desc: 'Overlays a heat map showing which regions the AI weighted most in its prediction.',
    when: 'Use to understand what the AI is focusing on.',
    requiresScan: true,
  },
  {
    label: 'Variations',
    technique: 'Counterfactual',
    key: 'generate_variation' as AgentToolName,
    desc: 'Generates a modified scan with different findings for comparison.',
    when: 'Start here — create a baseline AI scan before using other tools.',
    requiresScan: false,
  },
  {
    label: 'Visual Q&A',
    technique: 'Reasoning-Based',
    key: 'analyze_slice' as AgentToolName,
    desc: 'Captures the current slice and answers a free-form radiology question using vision AI.',
    when: 'Use to probe specific findings on this exact CT slice.',
    requiresScan: true,
  },
];

// ─── Agent selector options ───────────────────────────────────────────────────

const AGENT_SELECTOR_OPTIONS: {
  value: 'auto' | AgentToolName;
  label: string;
  icon: string;
  desc: string;
  model: string;
  requiresScan?: boolean;
}[] = [
  { value: 'auto',               label: 'Smart',         icon: '[◆]', desc: 'Routes your question to the right agent automatically', model: 'Gemini 2.0 Flash' },
  { value: 'generate_variation', label: 'Variations',    icon: '[+]', desc: 'Generate a counterfactual AI comparison scan',          model: 'Counterfactual AI' },
  { value: 'similar_cases',      label: 'Similar Cases', icon: '[~]', desc: 'Compare against similar diagnosed cases side-by-side',   model: 'Retrieval' },
  { value: 'saliency_overlay',   label: 'Saliency Maps', icon: '[*]', desc: 'Heat map of AI attention regions',                       model: 'PMAP', requiresScan: true },
  { value: 'analyze_slice',      label: 'Visual Q&A',    icon: '[?]', desc: 'Ask a specific question about this CT slice',            model: 'GPT-4o Vision', requiresScan: true },
];

function getPlaceholder(agent: 'auto' | AgentToolName): string {
  switch (agent) {
    case 'auto':              return "e.g. 'Show me the heat map' or 'What am I looking at here?'";
    case 'generate_variation':return 'Describe what variation to generate, or just press Send';
    case 'similar_cases':     return 'Press Send to show similar cases, or describe what to look for';
    case 'saliency_overlay':  return 'Press Send to show the saliency map';
    case 'analyze_slice':     return "e.g. 'What's the main finding?' or 'Is this normal?'";
  }
}

function getDefaultText(agent: AgentToolName): string {
  switch (agent) {
    case 'generate_variation': return 'Open the variation generator';
    case 'similar_cases':      return 'Show me similar cases';
    case 'saliency_overlay':   return 'Show me the saliency map';
    case 'analyze_slice':      return 'Analyze this CT slice';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const AgentTileHelpPopover: React.FC<{
  desc: string;
  when: string;
  requiresScan: boolean;
}> = ({ desc, when, requiresScan }) => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex items-center justify-center w-3.5 h-3.5 rounded-full border border-white/15
                   text-[8px] text-white/30 hover:text-white/60 hover:border-white/35 transition"
        aria-label="Agent info"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 w-52 rounded-xl border border-white/15 bg-[#0d1940] shadow-2xl p-3 space-y-1.5">
          <p className="text-[10px] text-white/65 leading-snug">{desc}</p>
          <p className="text-[10px] text-white/40 leading-snug italic">{when}</p>
          {requiresScan && (
            <p className="text-[9px] text-amber-400/70 leading-snug">
              Requires an AI comparison scan first
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const AgentSelectorPopup: React.FC<{
  selected: 'auto' | AgentToolName;
  hasGeneratedScan: boolean;
  onSelect: (v: 'auto' | AgentToolName) => void;
  onClose: () => void;
}> = ({ selected, hasGeneratedScan, onSelect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-2xl border border-white/15 bg-[#0d1940] shadow-2xl overflow-hidden"
    >
      <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        Select mode
      </p>
      {AGENT_SELECTOR_OPTIONS.map(opt => {
        const disabled = !!opt.requiresScan && !hasGeneratedScan;
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            disabled={disabled}
            onClick={() => { onSelect(opt.value); onClose(); }}
            className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition
              ${isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}
              ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
          >
            <span className="font-mono text-xs text-white/40 mt-0.5 shrink-0">{opt.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[12px] font-medium text-white/85 leading-tight">{opt.label}</p>
                <span className="rounded px-1.5 py-0.5 bg-white/[0.06] border border-white/10 text-[9px] text-white/35 font-mono leading-none">
                  {opt.model}
                </span>
                {isSelected && <span className="text-[9px] text-primary-main/80">active</span>}
              </div>
              <p className="text-[10px] text-white/40 leading-snug mt-0.5">{opt.desc}</p>
              {disabled && (
                <p className="text-[9px] text-amber-400/60 mt-0.5">Generate a scan first to unlock</p>
              )}
            </div>
          </button>
        );
      })}
      <div className="border-t border-white/10 px-4 py-2">
        <p className="text-[9px] text-white/20 leading-relaxed">
          Smart mode uses Gemini to route · Direct modes skip the AI router
        </p>
      </div>
    </div>
  );
};

const AgentCardHeader: React.FC<{
  agentName: AgentToolName;
  hasError?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}> = ({ agentName, hasError, collapsed, onToggle }) => (
  <div
    className={`flex items-center gap-2 px-4 py-3 border-b border-white/10 ${onToggle ? 'cursor-pointer select-none hover:bg-white/[0.02] transition' : ''}`}
    onClick={onToggle}
  >
    <span className="font-mono text-xs text-white/40">{AGENT_ICONS[agentName]}</span>
    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50 flex-1">
      {AGENT_LABELS[agentName]}
    </span>
    {hasError && <span className="text-[10px] text-red-400">Error</span>}
    {onToggle !== undefined && (
      <span className="text-[9px] text-white/25 ml-1">{collapsed ? '▼' : '▲'}</span>
    )}
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
    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-[#0b1433] px-4 py-3 text-sm text-white/70 leading-relaxed">
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
  const [collapsed, setCollapsed] = useState(agentName === 'generate_variation');
  const EmbeddedComponent = AGENT_COMPONENTS[agentName as ComponentAgentName];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1433] overflow-hidden">
      <AgentCardHeader
        agentName={agentName}
        hasError={status === 'error'}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
        <div className="overflow-hidden">
          {status === 'loading' && (
            <div className="px-4 py-3">
              <p className="text-sm text-white/50">Loading...</p>
            </div>
          )}
          {status === 'error' && (
            <div className="px-4 py-3">
              <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{errorMessage}</p>
            </div>
          )}
          {status === 'ready' && EmbeddedComponent && (
            <div className="min-h-[200px]">
              <EmbeddedComponent
                key={`${agentName}-${userMessageId}`}
                commandsManager={commandsManager}
                servicesManager={servicesManager}
                extensionManager={extensionManager}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TextAgentCard: React.FC<TextAgentMessage> = ({
  agentName,
  question,
  status,
  content,
  errorMessage,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1433] overflow-hidden">
      <AgentCardHeader
        agentName={agentName}
        hasError={status === 'error'}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
      />
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-4 py-3">
            <p className="text-xs text-white/40 italic mb-3">&ldquo;{question}&rdquo;</p>
            {status === 'loading' && (
              <p className="text-sm text-white/50">Capturing slice and consulting AI...</p>
            )}
            {status === 'done' && content && (
              <p className="rounded-xl bg-[#0e1c4a] p-3 text-sm leading-relaxed text-white">
                {content}
              </p>
            )}
            {status === 'error' && (
              <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{errorMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

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
  { text: 'Generate an AI comparison scan', hint: 'Create a counterfactual variation to compare against this patient scan' },
  { text: 'Show me similar diagnosed cases', hint: 'Compare against known presentations' },
  { text: "What regions drove the AI's prediction?", hint: 'Understand where the AI focused' },
  { text: "What's the main finding on this slice?", hint: 'Get an AI read of the current view' },
];

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
  const [selectedAgent, setSelectedAgent] = useState<'auto' | AgentToolName>('auto');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [tilesExpanded, setTilesExpanded] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasGeneratedScan = state.messages.some(
    m => m.role === 'agent' && (m as AgentMessage).agentName === 'generate_variation'
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, state.isThinking]);

  const handleSend = useCallback(async () => {
    if (state.isThinking) return;
    const isDirectAgent = selectedAgent !== 'auto';
    const text = inputText.trim() || (isDirectAgent ? getDefaultText(selectedAgent) : '');
    if (!text) return;
    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(text, isDirectAgent ? selectedAgent : undefined);
  }, [inputText, state.isThinking, sendMessage, selectedAgent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
  };

  const handleSuggestion = useCallback(
    (text: string) => { sendMessage(text); },
    [sendMessage]
  );

  const selectedLabel = AGENT_SELECTOR_OPTIONS.find(o => o.value === selectedAgent)?.label ?? 'Auto';

  return (
    <div className="ohif-scrollbar flex h-full flex-col bg-[#050c24] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-bold text-white leading-tight">Explainability Agent System</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-white/50 leading-snug">
                Four specialized AI agents working together
              </p>
              <button
                onClick={() => setTilesExpanded(e => !e)}
                className="text-[9px] text-white/25 hover:text-white/50 transition select-none"
                aria-label="Toggle agent tiles"
              >
                {tilesExpanded ? '▲' : '▼'}
              </button>
            </div>
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

        {/* Collapsible tile grid */}
        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${tilesExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {AGENT_TILE_INFO.map(({ label, technique, desc, when, requiresScan }) => (
                <div key={label} className="relative rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 pr-6">
                  <p className="text-[11px] font-medium text-white/80 leading-tight">{label}</p>
                  <p className="text-[9px] text-white/35 uppercase tracking-widest mt-0.5">{technique}</p>
                  <div className="absolute top-1.5 right-1.5">
                    <AgentTileHelpPopover desc={desc} when={when} requiresScan={requiresScan} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[10px] text-white/30 leading-relaxed">
              Auto mode routes your message — or pick an agent from the selector below
            </p>
          </div>
        </div>
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
        <div className="relative">
          {selectorOpen && (
            <AgentSelectorPopup
              selected={selectedAgent}
              hasGeneratedScan={hasGeneratedScan}
              onSelect={setSelectedAgent}
              onClose={() => setSelectorOpen(false)}
            />
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#0b1433] p-2">
            {/* Mode selector button */}
            <button
              onClick={() => setSelectorOpen(o => !o)}
              className="shrink-0 flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5
                         text-[11px] text-white/50 hover:text-white/75 hover:border-white/25 transition select-none"
            >
              <span>{selectedLabel}</span>
              <span className="text-[9px] text-white/25">{selectorOpen ? '▲' : '▼'}</span>
            </button>

            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={getPlaceholder(selectedAgent)}
              rows={1}
              className="ohif-scrollbar flex-1 resize-none bg-transparent text-sm text-white
                         placeholder-white/30 focus:outline-none leading-relaxed px-2 py-1"
              style={{ maxHeight: '128px' }}
            />
            <button
              onClick={handleSend}
              disabled={(selectedAgent === 'auto' && !inputText.trim()) || state.isThinking}
              className="shrink-0 rounded-full bg-primary-main px-4 py-2 text-xs font-semibold
                         text-black transition hover:bg-primary-light
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state.isThinking ? 'Thinking...' : 'Send'}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/25">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

export default MultiAgentPanel;
