import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import {
  Trash2 as Trash,
  Plus,
  ChevronDown,
  Search,
  Clock,
  Mail,
  Code,
  ChartLine,
  Bell,
  Zap,
} from "lucide-react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";

function HermesAvatar({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
  );
}

export { AgentMarkdown };

const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <HermesAvatar />
      )}
      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {msg.role === "agent" ? (
          <AgentMarkdown>{msg.content}</AgentMarkdown>
        ) : (
          msg.content
        )}
      </div>
      {msg.role === "agent" &&
        !isLoading &&
        isLast &&
        APPROVAL_RE.test(msg.content) && (
          <div className="chat-approval-bar">
            <button
              className="chat-approval-btn chat-approve"
              onClick={onApprove}
            >
              {t("chat.approve")}
            </button>
            <button className="chat-approval-btn chat-deny" onClick={onDeny}>
              {t("chat.deny")}
            </button>
          </div>
        )}
    </div>
  );
});

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
}

interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: { provider: string; model: string; label: string; baseUrl: string }[];
}

import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  } | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const isLoadingRef = useRef(false);
  const userScrolledUpRef = useRef(false);

  // Model picker state
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync for use in IPC callbacks
  isLoadingRef.current = isLoading;

  const scrollToBottom = useCallback((force?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset hermes session when messages are cleared (new chat)
  useEffect(() => {
    if (messages.length === 0) {
      setHermesSessionId(null);
    }
  }, [messages]);

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);

    // Group saved models by provider
    const groupMap = new Map<string, ModelGroup>();
    for (const m of savedModels) {
      if (!groupMap.has(m.provider)) {
        groupMap.set(m.provider, {
          provider: m.provider,
          providerLabel: PROVIDERS.labels[m.provider] || m.provider,
          models: [],
        });
      }
      groupMap.get(m.provider)!.models.push({
        provider: m.provider,
        model: m.model,
        label: m.name,
        baseUrl: m.baseUrl || "",
      });
    }
    setModelGroups(Array.from(groupMap.values()));
  }, [profile]);

  // Load model config and build available models list
  useEffect(() => {
    loadModelConfig();
  }, [loadModelConfig]);

  // Load fast mode state from config
  useEffect(() => {
    window.hermesAPI.getConfig("agent.service_tier", profile).then((val) => {
      setFastMode(val === "fast" || val === "priority");
    });
  }, [profile]);

  // Close picker on click outside
  useEffect(() => {
    if (!showModelPicker) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelPicker]);

  async function selectModel(
    provider: string,
    model: string,
    baseUrl: string,
  ): Promise<void> {
    await window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
    setCurrentModel(model);
    setCurrentProvider(provider);
    setCurrentBaseUrl(baseUrl);
    setShowModelPicker(false);
    setCustomModelInput("");
  }

  async function handleCustomModelSubmit(): Promise<void> {
    const model = customModelInput.trim();
    if (!model) return;
    await selectModel(
      currentProvider === "auto" ? "auto" : currentProvider,
      model,
      currentBaseUrl,
    );
  }

  // IPC listeners — stable callback refs, registered once
  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        // Append to existing agent message
        if (last && last.role === "agent") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // Only create a new message if chunk has visible content
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          { id: `agent-${Date.now()}`, role: "agent", content: chunk },
        ];
      });
    });

    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupError = window.hermesAPI.onChatError((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `Error: ${error}`,
        },
      ]);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress((tool) => {
      setToolProgress(tool);
    });

    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
      cleanupUsage();
    };
  }, [setMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Reset scroll lock when user sends a new message
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    // A new user message was just added — re-engage auto-scroll
    if (
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user"
    ) {
      userScrolledUpRef.current = false;
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom]);

  // Keyboard shortcut: Cmd+N for new chat
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        if (onNewChat) onNewChat();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      if (!text || isLoading) return;

      // Intercept slash commands that can be handled locally
      if (text.startsWith("/")) {
        const cmd = text.split(/\s+/)[0].toLowerCase();
        const isLocal = SLASH_COMMANDS.some(
          (c) => c.name === cmd && (c.local || c.category === "info"),
        );
        if (isLocal) {
          if (cmd !== "/new" && cmd !== "/clear") {
            setMessages((prev) => [
              ...prev,
              { id: `user-${Date.now()}`, role: "user", content: text },
            ]);
          }
          await executeLocalCommand(text);
          return;
        }
      }

      setIsLoading(true);
      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: text },
      ]);
      onSessionStarted?.();

      try {
        await window.hermesAPI.sendMessage(
          text,
          profile,
          hermesSessionId || undefined,
          messages.map((m) => ({ role: m.role, content: m.content })),
        );
      } catch {
        // Error already handled by onChatError IPC listener — avoid duplicate
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isLoading,
      profile,
      hermesSessionId,
      messages,
      onSessionStarted,
      setMessages,
    ],
  );

  const handleQuickAsk = useCallback(
    async (text: string): Promise<void> => {
      if (!text || isLoading) return;
      // /btw sends an ephemeral side question that doesn't pollute conversation context
      setIsLoading(true);
      setMessages((prev) => [
        ...prev,
        { id: `user-btw-${Date.now()}`, role: "user", content: `💭 ${text}` },
      ]);
      try {
        await window.hermesAPI.sendMessage(
          `/btw ${text}`,
          profile,
          hermesSessionId || undefined,
          messages.map((m) => ({ role: m.role, content: m.content })),
        );
      } catch {
        // Error already handled by onChatError IPC listener — avoid duplicate
      }
    },
    [isLoading, profile, hermesSessionId, messages, setMessages],
  );

  /** Push a fake agent message into the chat (for locally-handled commands). */
  function pushLocalResponse(content: string): void {
    setMessages((prev) => [
      ...prev,
      { id: `agent-local-${Date.now()}`, role: "agent", content },
    ]);
  }

  /**
   * Execute a slash command that can be resolved entirely in the desktop app.
   * Returns true if handled, false if the command should go to the backend.
   */
  async function executeLocalCommand(cmdText: string): Promise<boolean> {
    const parts = cmdText.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case "/new":
        onNewChat?.();
        return true;

      case "/clear":
        handleClear();
        return true;

      case "/model": {
        const mc = await window.hermesAPI.getModelConfig(profile);
        const display = mc.model || "Not set";
        const prov = mc.provider || "auto";
        pushLocalResponse(
          `**Current model:** \`${display}\`\n**Provider:** ${prov}${mc.baseUrl ? `\n**Base URL:** ${mc.baseUrl}` : ""}`,
        );
        return true;
      }

      case "/memory": {
        const mem = await window.hermesAPI.readMemory(profile);
        const lines: string[] = ["**Agent Memory**\n"];
        if (mem.memory.exists && mem.memory.content.trim()) {
          lines.push(mem.memory.content.trim());
        } else {
          lines.push(t("memory.noMemoryEntries"));
        }
        lines.push(
          `\n**Stats:** ${mem.stats.totalSessions} sessions, ${mem.stats.totalMessages} messages`,
        );
        pushLocalResponse(lines.join("\n"));
        return true;
      }

      case "/tools": {
        const tools = await window.hermesAPI.getToolsets(profile);
        if (!tools.length) {
          pushLocalResponse(t("memory.noToolsetsFound"));
        } else {
          const rows = tools
            .map(
              (t) =>
                `- **${t.label}** — ${t.description} ${t.enabled ? "*(enabled)*" : "*(disabled)*"}`,
            )
            .join("\n");
          pushLocalResponse(`**Available Toolsets**\n\n${rows}`);
        }
        return true;
      }

      case "/skills": {
        const skills = await window.hermesAPI.listInstalledSkills(profile);
        if (!skills.length) {
          pushLocalResponse("No skills installed.");
        } else {
          const rows = skills
            .map((s) => `- **${s.name}** (${s.category}) — ${s.description}`)
            .join("\n");
          pushLocalResponse(`**Installed Skills**\n\n${rows}`);
        }
        return true;
      }

      case "/persona": {
        const soul = await window.hermesAPI.readSoul(profile);
        pushLocalResponse(
          soul.trim()
            ? `**Current Persona**\n\n${soul.trim()}`
            : "_No persona configured._",
        );
        return true;
      }

      case "/version": {
        const [hermesVer, appVer] = await Promise.all([
          window.hermesAPI.getHermesVersion(),
          window.hermesAPI.getAppVersion(),
        ]);
        pushLocalResponse(
          `**Hermes Agent:** ${hermesVer || "unknown"}\n**Desktop App:** v${appVer}`,
        );
        return true;
      }

      case "/fast": {
        const current = await window.hermesAPI.getConfig(
          "agent.service_tier",
          profile,
        );
        const isOn = current === "fast" || current === "priority";
        const next = !isOn;
        setFastMode(next);
        await window.hermesAPI.setConfig(
          "agent.service_tier",
          next ? "fast" : "normal",
          profile,
        );
        pushLocalResponse(
          next
            ? "**Fast Mode: ON** — Priority processing enabled for lower latency."
            : "**Fast Mode: OFF** — Standard processing restored.",
        );
        return true;
      }

      case "/usage": {
        if (usage) {
          let md = `**Token Usage**\n\n`;
          md += `- **Prompt:** ${usage.promptTokens.toLocaleString()} tokens\n`;
          md += `- **Completion:** ${usage.completionTokens.toLocaleString()} tokens\n`;
          md += `- **Total:** ${usage.totalTokens.toLocaleString()} tokens\n`;
          if (usage.cost != null) {
            md += `- **Cost:** $${usage.cost.toFixed(4)}\n`;
          }
          pushLocalResponse(md);
        } else {
          pushLocalResponse(t("chat.noUsageData"));
        }
        return true;
      }

      case "/help": {
        const grouped: Record<string, SlashCommand[]> = {};
        for (const c of SLASH_COMMANDS) {
          (grouped[c.category] ||= []).push(c);
        }
        const categoryLabels: Record<string, string> = {
          chat: t("chat.categoryChat"),
          agent: t("chat.categoryAgent"),
          tools: t("chat.categoryTools"),
          info: t("chat.categoryInfo"),
        };
        let md = `**${t("chat.availableCommands")}**\n`;
        for (const cat of ["chat", "agent", "tools", "info"]) {
          if (!grouped[cat]) continue;
          md += `\n**${categoryLabels[cat]}**\n`;
          for (const c of grouped[cat]) {
            md += `\`${c.name}\` — ${c.description}\n`;
          }
        }
        pushLocalResponse(md);
        return true;
      }

      default:
        return false;
    }
  }

  const handleAbort = useCallback(() => {
    window.hermesAPI.abortChat();
    setIsLoading(false);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, []);

  function handleClear(): void {
    // Abort any in-flight request before clearing
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setToolProgress(null);
  }

  const handleApprove = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: `user-approve-${Date.now()}`, role: "user", content: "/approve" },
    ]);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    window.hermesAPI
      .sendMessage("/approve", profile, hermesSessionId || undefined, history)
      .catch(() => setIsLoading(false));
  }, [profile, hermesSessionId, setMessages, messages]);

  const handleDeny = useCallback(() => {
    chatInputRef.current?.clear();
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: `user-deny-${Date.now()}`, role: "user", content: "/deny" },
    ]);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    window.hermesAPI
      .sendMessage("/deny", profile, hermesSessionId || undefined, history)
      .catch(() => setIsLoading(false));
  }, [profile, hermesSessionId, setMessages, messages]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => (m.content || "").trim()),
    [messages],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  const lastMessageIsAgent = useMemo(
    () => messages.length > 0 && messages[messages.length - 1].role === "agent",
    [messages],
  );

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-header-title">
            {sessionId
              ? t("chat.sessionTitle", { id: sessionId.slice(-6) })
              : t("chat.title")}
          </div>
          {usage && (
            <span
              className="chat-token-counter"
              title={`Prompt: ${usage.promptTokens.toLocaleString()} | Completion: ${usage.completionTokens.toLocaleString()}${usage.cost != null ? ` | Cost: $${usage.cost.toFixed(4)}` : ""}`}
            >
              {usage.totalTokens.toLocaleString()} tokens
              {usage.cost != null && (
                <span className="chat-cost"> · ${usage.cost.toFixed(4)}</span>
              )}
            </span>
          )}
        </div>
        <div className="chat-header-actions">
          <div className="chat-fast-wrapper">
            <button
              className={`btn-ghost chat-fast-btn ${fastMode ? "chat-fast-active" : ""}`}
              onClick={async () => {
                const next = !fastMode;
                setFastMode(next);
                await window.hermesAPI.setConfig(
                  "agent.service_tier",
                  next ? "fast" : "normal",
                  profile,
                );
              }}
            >
              <Zap size={14} />
            </button>
            <div className="chat-fast-popover">
              <strong>
                {fastMode ? t("chat.fastModeOn") : t("chat.fastMode")}
              </strong>
              <span>
                {fastMode
                  ? t("chat.fastModeActive")
                  : t("chat.fastModeInactive")}
              </span>
            </div>
          </div>
          {onNewChat && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={onNewChat}
              title={t("chat.newChat")}
            >
              <Plus size={16} />
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={handleClear}
              title={t("chat.clearChat")}
            >
              <Trash size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <img src={icon} width={64} height={64} alt="" />
            </div>
            <div className="chat-empty-text">{t("chat.emptyTitle")}</div>
            <div className="chat-empty-hint">{t("chat.emptyHint")}</div>
            <div className="chat-empty-suggestions">
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Search the web for today's top tech news",
                  )
                }
              >
                <Search size={16} />
                {t("chat.suggestionSearch")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Set a reminder to check emails every day at 9 AM",
                  )
                }
              >
                <Bell size={16} />
                {t("chat.suggestionReminder")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Read my latest emails and summarize them",
                  )
                }
              >
                <Mail size={16} />
                {t("chat.suggestionEmail")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Write a Python script to rename all files in a folder",
                  )
                }
              >
                <Code size={16} />
                {t("chat.suggestionScript")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Schedule a cron job to back up my database every night",
                  )
                }
              >
                <Clock size={16} />
                {t("chat.suggestionSchedule")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() =>
                  chatInputRef.current?.setText(
                    "Analyze this CSV file and show key insights",
                  )
                }
              >
                <ChartLine size={16} />
                {t("chat.suggestionAnalyze")}
              </button>
            </div>
          </div>
        ) : (
          visibleMessages.map((msg, i) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              isLast={i === visibleMessages.length - 1}
              isLoading={isLoading}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          ))
        )}

        {isLoading && !lastMessageIsAgent && (
          <div className="chat-message chat-message-agent">
            <HermesAvatar />
            <div className="chat-bubble chat-bubble-agent">
              {toolProgress ? (
                <div className="chat-tool-progress">{toolProgress}</div>
              ) : (
                <div className="chat-typing">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading && toolProgress && lastMessageIsAgent && (
          <div className="chat-tool-progress-inline">{toolProgress}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <ChatInput
          ref={chatInputRef}
          isLoading={isLoading}
          hasSession={!!hermesSessionId}
          onSubmit={handleSend}
          onQuickAsk={handleQuickAsk}
          onAbort={handleAbort}
        />

        <div className="chat-model-bar" ref={pickerRef}>
          <button
            className="chat-model-trigger"
            onClick={() => {
              if (!showModelPicker) loadModelConfig();
              setShowModelPicker(!showModelPicker);
            }}
          >
            <span className="chat-model-name">{displayModel}</span>
            <ChevronDown size={12} />
          </button>

          {showModelPicker && (
            <div className="chat-model-dropdown">
              {modelGroups.map((group) => (
                <div key={group.provider} className="chat-model-group">
                  <div className="chat-model-group-label">
                    {t(group.providerLabel)}
                  </div>
                  {group.models.map((m) => (
                    <button
                      key={`${m.provider}:${m.model}`}
                      className={`chat-model-option ${currentModel === m.model && currentProvider === m.provider ? "active" : ""}`}
                      onClick={() =>
                        selectModel(m.provider, m.model, m.baseUrl)
                      }
                    >
                      <span className="chat-model-option-label">{m.label}</span>
                      <span className="chat-model-option-id">{m.model}</span>
                    </button>
                  ))}
                </div>
              ))}

              <div className="chat-model-group">
                <div className="chat-model-group-label">{t("chat.custom")}</div>
                <div className="chat-model-custom">
                  <input
                    className="chat-model-custom-input"
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCustomModelSubmit();
                    }}
                    placeholder={t("chat.typeModelName")}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Chat;
