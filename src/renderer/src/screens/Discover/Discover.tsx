import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Refresh,
  Download,
  Trash,
  Check,
  X,
  ExternalLink,
  Puzzle,
  Plug,
  Bot,
  Workflow as WorkflowIcon,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
} from "../../../../shared/registry";

interface DiscoverProps {
  profile?: string;
  visible?: boolean;
}

interface LocalSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

const KINDS: { key: RegistryKind; icon: LucideIcon }[] = [
  { key: "skills", icon: Puzzle },
  { key: "mcps", icon: Plug },
  { key: "agents", icon: Bot },
  { key: "workflows", icon: WorkflowIcon },
];

const EMPTY: RegistryCatalog = {
  skills: [],
  mcps: [],
  agents: [],
  workflows: [],
};

type ActionState = "idle" | "working" | "done" | "error";
type SkillsView = "installed" | "community";

export default function Discover({
  profile,
  visible,
}: DiscoverProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<RegistryKind>("skills");
  // Skills get an extra Installed/Community toggle; installed is the default
  // so users land on their local skills.
  const [skillsView, setSkillsView] = useState<SkillsView>("installed");
  const [catalog, setCatalog] = useState<RegistryCatalog>(EMPTY);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [installed, setInstalled] = useState<{
    skills: string[];
    mcps: string[];
    workflows: string[];
    agents: string[];
  }>({ skills: [], mcps: [], workflows: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  // Skill detail modal (markdown preview + remove).
  const [detailSkill, setDetailSkill] = useState<LocalSkill | null>(null);
  const [detailContent, setDetailContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const loadInstalled = useCallback(async () => {
    try {
      const [reg, profiles, skills] = await Promise.all([
        window.hermesAPI.listInstalledRegistry(profile),
        window.hermesAPI.listProfiles(),
        window.hermesAPI.listInstalledSkills(profile),
      ]);
      setLocalSkills(skills);
      setInstalled({
        skills: skills.map((s) => s.name),
        mcps: reg.mcps,
        workflows: reg.workflows,
        agents: profiles.map((p) => p.name),
      });
    } catch {
      /* leave as-is */
    }
  }, [profile]);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const data = await window.hermesAPI.fetchRegistry(force);
        if (data.error) setError(data.error);
        setCatalog({
          skills: data.skills ?? [],
          mcps: data.mcps ?? [],
          agents: data.agents ?? [],
          workflows: data.workflows ?? [],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        setCatalog(EMPTY);
      } finally {
        setLoading(false);
      }
      loadInstalled();
    },
    [loadInstalled],
  );

  // Load once on first mount, and refresh the installed-set whenever the
  // screen becomes visible (a switch elsewhere may have changed it).
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (visible) loadInstalled();
  }, [visible, loadInstalled]);

  const showLocalSkills = tab === "skills" && skillsView === "installed";

  const isInstalled = useCallback(
    (kind: RegistryKind, item: RegistryItem): boolean => {
      switch (kind) {
        case "skills":
          return (
            installed.skills.includes(item.name) ||
            installed.skills.includes(item.id)
          );
        case "mcps":
          return installed.mcps.includes(item.id);
        case "agents":
          return installed.agents.includes(item.id);
        case "workflows":
          return installed.workflows.includes(item.id);
      }
    },
    [installed],
  );

  const matchesQuery = useCallback(
    (...fields: (string | undefined)[]): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return fields.some((f) => f && f.toLowerCase().includes(q));
    },
    [query],
  );

  const items = useMemo(() => {
    const list = catalog[tab] ?? [];
    return list.filter((i) =>
      matchesQuery(
        i.name,
        i.description,
        i.author,
        i.category,
        ...(i.tags ?? []),
      ),
    );
  }, [catalog, tab, matchesQuery]);

  const localItems = useMemo(
    () =>
      localSkills.filter((s) =>
        matchesQuery(s.name, s.description, s.category),
      ),
    [localSkills, matchesQuery],
  );

  function tabCount(key: RegistryKind): number {
    if (key === "skills" && skillsView === "installed")
      return localSkills.length;
    return (catalog[key] ?? []).length;
  }

  async function handleInstall(
    kind: RegistryKind,
    item: RegistryItem,
  ): Promise<void> {
    const key = `${kind}:${item.id}`;
    setActions((a) => ({ ...a, [key]: "working" }));
    setActionError((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    try {
      const res = await window.hermesAPI.installRegistryItem(
        kind,
        item,
        profile,
      );
      if (res.success) {
        setActions((a) => ({ ...a, [key]: "done" }));
        await loadInstalled();
      } else {
        setActions((a) => ({ ...a, [key]: "error" }));
        if (res.error) setActionError((e) => ({ ...e, [key]: res.error! }));
      }
    } catch (err) {
      setActions((a) => ({ ...a, [key]: "error" }));
      setActionError((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : "Failed",
      }));
    }
  }

  async function openSkillDetail(skill: LocalSkill): Promise<void> {
    setDetailSkill(skill);
    setDetailContent("");
    setDetailLoading(true);
    try {
      const content = await window.hermesAPI.getSkillContent(skill.path);
      setDetailContent(content);
    } catch {
      setDetailContent("");
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    const key = `skill-local:${name}`;
    setActions((a) => ({ ...a, [key]: "working" }));
    setActionError((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    try {
      const res = await window.hermesAPI.uninstallSkill(name, profile);
      if (res.success) {
        setActions((a) => {
          const next = { ...a };
          delete next[key];
          return next;
        });
        setDetailSkill(null);
        await loadInstalled();
      } else {
        setActions((a) => ({ ...a, [key]: "error" }));
        if (res.error) setActionError((e) => ({ ...e, [key]: res.error! }));
      }
    } catch (err) {
      setActions((a) => ({ ...a, [key]: "error" }));
      setActionError((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : "Failed",
      }));
    }
  }

  const ActiveIcon = KINDS.find((k) => k.key === tab)?.icon ?? Puzzle;
  const hasResults = showLocalSkills ? localItems.length > 0 : items.length > 0;

  const detailKey = detailSkill ? `skill-local:${detailSkill.name}` : "";
  const detailState = actions[detailKey] ?? "idle";

  return (
    <div className="discover-container">
      {detailSkill && (
        <div
          className="discover-modal-overlay"
          onClick={() => setDetailSkill(null)}
        >
          <div
            className="discover-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="discover-modal-header">
              <div className="discover-modal-titles">
                <div className="discover-modal-name">
                  <Puzzle size={18} className="discover-card-icon" />
                  {detailSkill.name}
                </div>
                {detailSkill.category && (
                  <span className="discover-card-badge">
                    {detailSkill.category}
                  </span>
                )}
              </div>
              <div className="discover-modal-actions">
                <button
                  className="btn btn-secondary btn-sm discover-uninstall-btn"
                  onClick={() => handleUninstall(detailSkill.name)}
                  disabled={detailState === "working"}
                >
                  <Trash size={14} />
                  {detailState === "working"
                    ? t("discover.uninstalling")
                    : t("discover.uninstall")}
                </button>
                <button
                  className="btn-ghost discover-modal-close"
                  onClick={() => setDetailSkill(null)}
                  aria-label={t("discover.close")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {detailState === "error" && actionError[detailKey] && (
              <div className="discover-modal-error">
                {actionError[detailKey]}
              </div>
            )}
            <div className="discover-modal-content">
              {detailLoading ? (
                <div className="loading-spinner" />
              ) : detailContent ? (
                <AgentMarkdown>{detailContent}</AgentMarkdown>
              ) : (
                <p className="discover-empty-text">{detailSkill.description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="discover-header">
        <h1 className="discover-title">{t("discover.title")}</h1>
        <p className="discover-subtitle">{t("discover.subtitle")}</p>
      </div>

      <div className="discover-tabs">
        {KINDS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={`discover-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            {t(`discover.tabs.${key}`)}
            <span className="discover-tab-count">{tabCount(key)}</span>
          </button>
        ))}
      </div>

      <div className="discover-toolbar">
        {tab === "skills" && (
          <div className="discover-segment">
            <button
              className={`discover-segment-btn ${
                skillsView === "installed" ? "active" : ""
              }`}
              onClick={() => setSkillsView("installed")}
            >
              {t("discover.installedSegment")}
            </button>
            <button
              className={`discover-segment-btn ${
                skillsView === "community" ? "active" : ""
              }`}
              onClick={() => setSkillsView("community")}
            >
              {t("discover.communitySegment")}
            </button>
          </div>
        )}
        <div className="discover-search">
          <Search size={15} />
          <input
            className="discover-search-input"
            placeholder={t("discover.searchPlaceholder", {
              kind: t(`discover.tabs.${tab}`).toLowerCase(),
            })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!showLocalSkills && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => load(true)}
            disabled={loading}
          >
            <Refresh size={14} />
            {t("discover.refresh")}
          </button>
        )}
      </div>

      {loading && !showLocalSkills ? (
        <div className="discover-state">
          <div className="loading-spinner" />
        </div>
      ) : showLocalSkills ? (
        localItems.length === 0 ? (
          <div className="discover-state">
            <Puzzle size={28} />
            <p className="discover-empty-title">
              {t("discover.localEmptyTitle")}
            </p>
            <p className="discover-empty-text">
              {t("discover.localEmptyText")}
            </p>
          </div>
        ) : (
          <div className="discover-grid">
            {localItems.map((skill) => (
              <button
                key={skill.path}
                className="discover-card discover-card--clickable"
                onClick={() => openSkillDetail(skill)}
              >
                <div className="discover-card-head">
                  <span className="discover-card-iconwrap">
                    <Puzzle size={16} />
                  </span>
                  <span className="discover-card-name">{skill.name}</span>
                  {skill.category && (
                    <span className="discover-card-badge">
                      {skill.category}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="discover-card-desc">{skill.description}</p>
                )}
              </button>
            ))}
          </div>
        )
      ) : error && !hasResults ? (
        <div className="discover-state">
          <p className="discover-empty-title">{t("discover.loadError")}</p>
          <p className="discover-empty-text">{error}</p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => load(true)}
          >
            {t("discover.retry")}
          </button>
        </div>
      ) : !hasResults ? (
        <div className="discover-state">
          <ActiveIcon size={28} />
          <p className="discover-empty-title">{t("discover.emptyTitle")}</p>
          <p className="discover-empty-text">
            {t("discover.emptyText", {
              kind: t(`discover.tabs.${tab}`).toLowerCase(),
            })}
          </p>
        </div>
      ) : (
        <div className="discover-grid">
          {items.map((item) => {
            const key = `${tab}:${item.id}`;
            const state = actions[key] ?? "idle";
            const done = state === "done" || isInstalled(tab, item);
            const meta = [
              item.category,
              item.model,
              item.author && t("discover.by", { author: item.author }),
            ].filter(Boolean);
            return (
              <div key={key} className="discover-card">
                <div className="discover-card-head">
                  <ActiveIcon size={18} className="discover-card-icon" />
                  <span className="discover-card-name">{item.name}</span>
                </div>
                {meta.length > 0 && (
                  <div className="discover-card-meta">{meta.join(" · ")}</div>
                )}
                <p className="discover-card-desc">{item.description}</p>
                {item.tags && item.tags.length > 0 && (
                  <div className="discover-card-tags">
                    {item.tags.slice(0, 4).map((tg) => (
                      <span key={tg} className="discover-tag">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
                {state === "error" && actionError[key] && (
                  <div className="discover-card-error">{actionError[key]}</div>
                )}
                <div className="discover-card-footer">
                  {item.homepage && (
                    <a
                      className="discover-card-link"
                      href={item.homepage}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={13} />
                      {t("discover.viewSource")}
                    </a>
                  )}
                  {done ? (
                    <span className="discover-card-installed">
                      <Check size={14} />
                      {t("discover.installed")}
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm discover-install-btn"
                      onClick={() => handleInstall(tab, item)}
                      disabled={state === "working"}
                      title={t("discover.targetProfile")}
                    >
                      <Download size={14} />
                      {state === "working"
                        ? t("discover.installing")
                        : t("discover.install")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
