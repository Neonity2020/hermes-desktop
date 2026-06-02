import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { installSkill, listInstalledSkills } from "./skills";
import { createProfile } from "./profiles";
import { listMcpServers } from "./installer";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  InstalledRegistry,
} from "../shared/registry";

export type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
} from "../shared/registry";

/**
 * The "Discover" marketplace reads its catalog from a public GitHub repo:
 *   https://github.com/fathah/hermes-registry
 *
 * The repo's `registry.json` (on the default branch) lists community Skills,
 * MCP servers, Agents (profiles), and Workflows. Items are fetched read-only;
 * "setup" actions install them into the active profile.
 */
const REGISTRY_REPO = "fathah/hermes-registry";
const REGISTRY_BRANCH = "main";
const REGISTRY_RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_BRANCH}`;
const REGISTRY_URL = `${REGISTRY_RAW_BASE}/registry.json`;

const EMPTY_CATALOG: RegistryCatalog = {
  skills: [],
  mcps: [],
  agents: [],
  workflows: [],
};

// Short-lived cache so flipping between Discover sub-tabs doesn't refetch.
let cache: { at: number; data: RegistryCatalog } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function asArray(value: unknown): RegistryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is RegistryItem =>
      !!v &&
      typeof v === "object" &&
      typeof (v as RegistryItem).id === "string",
  );
}

/**
 * Fetch and normalise the community catalog. Network/parse failures resolve to
 * an empty catalog (with `error` set) rather than throwing, so the screen can
 * render an empty state instead of crashing.
 */
export async function fetchRegistry(
  force = false,
): Promise<RegistryCatalog & { error?: string }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ...EMPTY_CATALOG, error: `Registry returned ${res.status}` };
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const data: RegistryCatalog = {
      skills: asArray(raw.skills),
      mcps: asArray(raw.mcps),
      agents: asArray(raw.agents),
      workflows: asArray(raw.workflows),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      ...EMPTY_CATALOG,
      error: err instanceof Error ? err.message : "Failed to load registry",
    };
  }
}

/**
 * Names already present in the active profile, per kind, so the UI can mark
 * catalog items as "Installed".
 */
export function listInstalledRegistry(profile?: string): InstalledRegistry {
  let skills: string[] = [];
  let mcps: string[] = [];
  let workflows: string[] = [];
  try {
    skills = listInstalledSkills(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    mcps = listMcpServers(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    const dir = join(profileHome(profile), "workflows");
    if (existsSync(dir)) {
      workflows = readdirSync(dir)
        .filter((f) => /\.(js|mjs|ts)$/.test(f))
        .map((f) => f.replace(/\.(js|mjs|ts)$/, ""));
    }
  } catch {
    /* ignore */
  }
  return { skills, mcps, workflows };
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

/** Quote a string for single-line YAML if it needs it. */
function yamlScalar(value: string): string {
  return /[:#{}[\],&*?|<>=!%@`"']/.test(value) || value.trim() !== value
    ? JSON.stringify(value)
    : value;
}

/** Render one MCP server as an indented YAML block (2-space base indent). */
function renderMcpYaml(item: RegistryItem): string {
  const cfg = item.config ?? {};
  const lines: string[] = [`  ${item.id}:`];
  if (item.transport === "http" || cfg.url) {
    if (cfg.url) lines.push(`    url: ${yamlScalar(cfg.url)}`);
    if (cfg.headers) {
      lines.push(`    headers:`);
      for (const [k, v] of Object.entries(cfg.headers)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  } else {
    if (cfg.command) lines.push(`    command: ${yamlScalar(cfg.command)}`);
    if (cfg.args?.length) {
      lines.push(`    args:`);
      for (const a of cfg.args) lines.push(`      - ${yamlScalar(String(a))}`);
    }
    if (cfg.env) {
      lines.push(`    env:`);
      for (const [k, v] of Object.entries(cfg.env)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  }
  lines.push(`    enabled: true`);
  return lines.join("\n") + "\n";
}

/**
 * Add (or replace) an MCP server entry under `mcp_servers:` in the profile's
 * config.yaml. Mirrors the regex-based reader in installer.ts — no YAML lib is
 * available, so we splice text directly.
 */
function installMcp(item: RegistryItem, profile?: string): InstallResult {
  if (!item.config || (!item.config.url && !item.config.command)) {
    return {
      success: false,
      error: "Registry MCP entry has no connection config",
    };
  }
  const configPath = join(profileHome(profile), "config.yaml");
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";

  const block = renderMcpYaml(item);
  const sectionRe = /^mcp_servers:\s*\n/m;

  if (sectionRe.test(content)) {
    // Already configured? Bail rather than duplicate.
    if (new RegExp(`^[ ]{2}${item.id}:\\s*$`, "m").test(content)) {
      return { success: false, error: "Already configured" };
    }
    content = content.replace(sectionRe, (m) => m + block);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `mcp_servers:\n${block}`;
  }

  try {
    safeWriteFile(configPath, content);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to write config",
    };
  }
}

/** Save a community workflow script into <profile>/workflows/<id>.js. */
async function installWorkflow(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  const url = item.scriptUrl
    ? item.scriptUrl
    : item.scriptPath
      ? `${REGISTRY_RAW_BASE}/${item.scriptPath.replace(/^\/+/, "")}`
      : null;
  if (!url) return { success: false, error: "Workflow has no script URL" };
  try {
    const res = await fetch(url);
    if (!res.ok)
      return { success: false, error: `Fetch failed (${res.status})` };
    const script = await res.text();
    const dest = join(profileHome(profile), "workflows", `${item.id}.js`);
    safeWriteFile(dest, script);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save workflow",
    };
  }
}

/**
 * Install/"set up" a catalog item into the active profile. Each kind maps to an
 * existing local mechanism:
 *   - skill    → `hermes skills install <source>`
 *   - mcp      → append to config.yaml `mcp_servers:`
 *   - agent    → create a cloned profile named after the agent
 *   - workflow → download the script into <profile>/workflows/
 */
export async function installRegistryItem(
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  switch (kind) {
    case "skills":
      return installSkill(item.source || item.id, profile);
    case "mcps":
      return installMcp(item, profile);
    case "agents":
      return createProfile(item.id, true);
    case "workflows":
      return installWorkflow(item, profile);
    default:
      return { success: false, error: "Unknown item kind" };
  }
}
