import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { profilePaths, escapeRegex, safeWriteFile } from "./utils";

// ── Connection Config (local / remote / ssh) ─────────────

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface ConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  apiKey: string;
  ssh: SshConnectionConfig;
}

export interface PublicConnectionConfig {
  mode: "local" | "remote" | "ssh";
  remoteUrl: string;
  hasApiKey: boolean;
  ssh: SshConnectionConfig;
}

// Lazy getter — avoids circular dependency with installer.ts
// (HERMES_HOME may not be assigned yet when this module first loads)
function desktopConfigFile(): string {
  return join(HERMES_HOME, "desktop.json");
}

function readDesktopConfig(): Record<string, unknown> {
  try {
    const f = desktopConfigFile();
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return {};
  }
}

function writeDesktopConfig(data: Record<string, unknown>): void {
  if (!existsSync(HERMES_HOME)) {
    mkdirSync(HERMES_HOME, { recursive: true });
  }
  writeFileSync(desktopConfigFile(), JSON.stringify(data, null, 2), "utf-8");
}

export function getConnectionConfig(): ConnectionConfig {
  const data = readDesktopConfig();
  const ssh = (data.sshConfig as Partial<SshConnectionConfig>) ?? {};
  return {
    mode: (data.connectionMode as "local" | "remote" | "ssh") || "local",
    remoteUrl: (data.remoteUrl as string) || "",
    apiKey: (data.remoteApiKey as string) || "",
    ssh: {
      host: (ssh.host as string) || "",
      port: (ssh.port as number) || 22,
      username: (ssh.username as string) || "",
      keyPath: (ssh.keyPath as string) || "",
      remotePort: (ssh.remotePort as number) || 8642,
      localPort: (ssh.localPort as number) || 18642,
    },
  };
}

export function getPublicConnectionConfig(): PublicConnectionConfig {
  const config = getConnectionConfig();
  return {
    mode: config.mode,
    remoteUrl: config.remoteUrl,
    hasApiKey: config.apiKey.length > 0,
    ssh: config.ssh,
  };
}

export function setConnectionConfig(config: ConnectionConfig): void {
  const data = readDesktopConfig();
  data.connectionMode = config.mode;
  data.remoteUrl = config.remoteUrl;
  data.remoteApiKey = config.apiKey;
  if (config.mode === "ssh") {
    data.sshConfig = config.ssh;
  }
  writeDesktopConfig(data);
}

export function resolveConnectionApiKeyUpdate(
  existing: ConnectionConfig,
  mode: "local" | "remote" | "ssh",
  remoteUrl: string,
  apiKey?: string,
): string {
  if (apiKey !== undefined) return apiKey;
  if (existing.mode === mode && existing.remoteUrl === remoteUrl) {
    return existing.apiKey;
  }
  return "";
}

// ── In-memory cache with TTL ─────────────────────────────
const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getCached<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

export function readEnv(profile?: string): Record<string, string> {
  const cacheKey = `env:${profile || "default"}`;
  const cached = getCached<Record<string, string>>(cacheKey);
  if (cached) return cached;

  const { envFile } = profilePaths(profile);
  if (!existsSync(envFile)) return {};

  const content = readFileSync(envFile, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const eqIndex = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value) result[key] = value;
  }

  setCache(cacheKey, result);
  return result;
}

export function setEnvValue(
  key: string,
  value: string,
  profile?: string,
): void {
  validateEnvEntry(key, value);

  const { envFile } = profilePaths(profile);
  invalidateCache(`env:${profile || "default"}`);

  if (!existsSync(envFile)) {
    safeWriteFile(envFile, `${key}=${value}\n`);
    return;
  }

  const content = readFileSync(envFile, "utf-8");
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(new RegExp(`^#?\\s*${escapeRegex(key)}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  safeWriteFile(envFile, lines.join("\n"));
}

export function validateEnvEntry(key: string, value: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(
      "Invalid environment variable name. Use letters, numbers, and underscores, and do not start with a number.",
    );
  }

  if (/[\0\r\n]/.test(value)) {
    throw new Error("Environment variable values must be single-line strings.");
  }
}

export function getConfigValue(key: string, profile?: string): string | null {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return null;

  const content = readFileSync(configFile, "utf-8");
  const regex = new RegExp(
    `^\\s*${escapeRegex(key)}:\\s*["']?([^"'\\n#]+)["']?`,
    "m",
  );
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");
  const regex = new RegExp(
    `^(\\s*#?\\s*${escapeRegex(key)}:\\s*)["']?[^"'\\n#]*["']?`,
    "m",
  );

  if (regex.test(content)) {
    content = content.replace(regex, `$1"${value}"`);
  }

  safeWriteFile(configFile, content);
}

/**
 * Locate the direct children of a top-level YAML block. Each child is
 * keyed by name and carries the substring offsets needed to read or
 * rewrite its value in-place.
 *
 * Why this exists: the model-field readers/writers used to run loose
 * regexes like `^\s*default:` against the whole file, which match any
 * `default:` at any indent — so a `personalities.default` description
 * would be picked up as the model name (issue #242), and toggling the
 * model in the UI would overwrite that personality string instead of
 * `model.default`. Scoping reads and writes to a named top-level block
 * fixes both directions.
 *
 * Direct (sibling) children only: keys nested deeper than one indent
 * under the block are ignored. The block ends at the first non-indented,
 * non-empty line — the next top-level key. Anchored block-header search
 * means a `model:` later in some other context (e.g. a YAML string
 * literal, or nested under another block) won't be mistaken for the
 * top-level `model:` we want.
 */
interface BlockChild {
  key: string;
  /** Parsed value, with surrounding single/double quotes stripped. */
  value: string;
  /** Indent string of this child's line (e.g. "  "). */
  indent: string;
  /** Absolute offset of the substring after `key: ` and any leading
   *  whitespace — where a writer should splice the new value. */
  valueStart: number;
  /** Absolute offset just past the substring the writer should replace
   *  (excludes any trailing comment so we don't clobber `# notes`). */
  valueEnd: number;
}

function readTopLevelBlock(
  content: string,
  blockName: string,
): {
  children: Map<string, BlockChild>;
  blockBodyStart: number | null;
  childIndent: string;
} {
  const startRe = new RegExp(`^${escapeRegex(blockName)}:[ \\t]*\\r?\\n`, "m");
  const start = content.match(startRe);
  if (!start || start.index === undefined) {
    return { children: new Map(), blockBodyStart: null, childIndent: "  " };
  }

  const blockBodyStart = start.index + start[0].length;
  const children = new Map<string, BlockChild>();
  let firstChildIndent: string | null = null;
  let cursor = blockBodyStart;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);

    // Stop at a non-indented, non-empty line (= next top-level key).
    if (line.trim() !== "" && !/^\s/.test(line)) break;

    const m = line.match(
      /^([ \t]+)([A-Za-z_][A-Za-z0-9_-]*):([ \t]*)([^\n#]*?)([ \t]*)(#.*)?$/,
    );
    if (m) {
      const indent = m[1];
      const key = m[2];
      const gapBeforeValue = m[3];
      const rawValue = m[4];
      const trailingWhitespace = m[5];
      void trailingWhitespace; // not used for replacement boundaries

      // First child encountered sets the canonical indent. Anything more
      // indented is a nested child (skip); anything less is malformed.
      if (firstChildIndent === null) firstChildIndent = indent;
      if (indent === firstChildIndent && !children.has(key)) {
        const keyEnd = cursor + indent.length + key.length + 1; // past `:`
        const valueStart = keyEnd + gapBeforeValue.length;
        const valueEnd = valueStart + rawValue.length;
        children.set(key, {
          key,
          value: stripYamlQuotes(rawValue),
          indent,
          valueStart,
          valueEnd,
        });
      }
    }

    cursor =
      lineEndExclusive === content.length ? content.length : lineEndExclusive + 1;
  }

  return {
    children,
    blockBodyStart,
    childIndent: firstChildIndent ?? "  ",
  };
}

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function getModelConfig(profile?: string): {
  provider: string;
  model: string;
  baseUrl: string;
} {
  const cacheKey = `mc:${profile || "default"}`;
  const cached = getCached<{
    provider: string;
    model: string;
    baseUrl: string;
  }>(cacheKey);
  if (cached) return cached;

  const { configFile } = profilePaths(profile);
  const defaults = { provider: "auto", model: "", baseUrl: "" };
  if (!existsSync(configFile)) return defaults;

  const content = readFileSync(configFile, "utf-8");
  const { children } = readTopLevelBlock(content, "model");

  const result = {
    provider: children.get("provider")?.value || defaults.provider,
    model: children.get("default")?.value || defaults.model,
    baseUrl: children.get("base_url")?.value || defaults.baseUrl,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Replace a direct child's value inside a top-level YAML block in-place,
 * preserving the key's surrounding whitespace and any trailing comment.
 * When the child doesn't exist, insert it as the first sibling at the
 * block's existing indent. When the block itself doesn't exist, append
 * one with the new key inside.
 */
function upsertBlockChild(
  content: string,
  blockName: string,
  key: string,
  value: string,
): string {
  const { children, blockBodyStart, childIndent } = readTopLevelBlock(
    content,
    blockName,
  );

  const existing = children.get(key);
  if (existing) {
    return (
      content.slice(0, existing.valueStart) +
      `"${value}"` +
      content.slice(existing.valueEnd)
    );
  }

  if (blockBodyStart !== null) {
    const insertion = `${childIndent}${key}: "${value}"\n`;
    return (
      content.slice(0, blockBodyStart) +
      insertion +
      content.slice(blockBodyStart)
    );
  }

  // No block at all → append one. Match the existing file's trailing
  // newline conventions; if the file is empty (e.g. setModelConfig is
  // bootstrapping a fresh config.yaml) skip the separator so we don't
  // leave a stray leading blank line.
  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}${blockName}:\n  ${key}: "${value}"\n`;
}

export function setModelConfig(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): void {
  invalidateCache(`mc:${profile || "default"}`);
  const { configFile } = profilePaths(profile);

  // Bootstrap an empty config.yaml when it's missing — previously this
  // function early-returned, so users on a custom HERMES_HOME where the
  // file hadn't been created (issue #228) had their model selection
  // silently dropped: the desktop appeared to save it but config.yaml
  // never got written, and the Python gateway saw an empty model and
  // returned 404s. `safeWriteFile` (used below) will create parent dirs
  // as needed; `upsertBlockChild` produces a valid minimal YAML doc
  // from an empty starting string.
  let content = existsSync(configFile)
    ? readFileSync(configFile, "utf-8")
    : "";

  content = upsertBlockChild(content, "model", "provider", provider);
  content = upsertBlockChild(content, "model", "default", model);
  if (baseUrl) {
    content = upsertBlockChild(content, "model", "base_url", baseUrl);
  }

  // Disable smart_model_routing
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  content = lines.join("\n");

  // Enable streaming
  const streamingRegex = /^(\s*streaming:\s*)(\S+)/m;
  if (streamingRegex.test(content)) {
    content = content.replace(streamingRegex, "$1true");
  }

  safeWriteFile(configFile, content);
}

export function getHermesHome(profile?: string): string {
  return profilePaths(profile).home;
}

// ── Platform enabled/disabled in config.yaml ────────────

const SUPPORTED_PLATFORMS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
];

export function getPlatformEnabled(profile?: string): Record<string, boolean> {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return {};

  const content = readFileSync(configFile, "utf-8");
  const result: Record<string, boolean> = {};

  for (const platform of SUPPORTED_PLATFORMS) {
    // Match "  platform:\n    enabled: true/false" under the platforms: block
    const re = new RegExp(
      `^[ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*(true|false)`,
      "m",
    );
    const match = content.match(re);
    result[platform] = match ? match[1] === "true" : false;
  }

  return result;
}

export function setPlatformEnabled(
  platform: string,
  enabled: boolean,
  profile?: string,
): void {
  if (!SUPPORTED_PLATFORMS.includes(platform)) return;

  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;

  let content = readFileSync(configFile, "utf-8");

  // Check if the platform entry already exists under platforms:
  const existingRe = new RegExp(
    `^([ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*)(?:true|false)`,
    "m",
  );

  if (existingRe.test(content)) {
    // Update existing entry
    content = content.replace(existingRe, `$1${enabled}`);
  } else {
    // Append new platform entry after the platforms: block
    // Find the platforms: line and insert after the last existing platform entry
    const platformsIdx = content.indexOf("\nplatforms:");
    if (platformsIdx === -1) {
      // No platforms section at all — append one
      content += `\nplatforms:\n  ${platform}:\n    enabled: ${enabled}\n`;
    } else {
      // Insert the new platform at the end of the platforms block.
      // Find the next top-level key (non-indented, non-comment, non-empty line)
      // after the platforms: line.
      const afterPlatforms = content.substring(platformsIdx + 1);
      const lines = afterPlatforms.split("\n");
      let insertOffset = platformsIdx + 1; // after the \n
      // Skip the "platforms:" line itself
      insertOffset += lines[0].length + 1;

      // Skip all indented lines (children of platforms:)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "" || /^\s/.test(line)) {
          insertOffset += line.length + 1;
        } else {
          break;
        }
      }

      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      content =
        content.substring(0, insertOffset) +
        entry +
        content.substring(insertOffset);
    }
  }

  safeWriteFile(configFile, content);
}

// ── Credential Pool (auth.json) ──────────────────────────

function authFilePath(): string {
  return join(HERMES_HOME, "auth.json");
}

interface CredentialEntry {
  key: string;
  label: string;
}

function readAuthStore(): Record<string, unknown> {
  try {
    const p = authFilePath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeAuthStore(store: Record<string, unknown>): void {
  safeWriteFile(authFilePath(), JSON.stringify(store, null, 2));
}

export function getCredentialPool(): Record<string, CredentialEntry[]> {
  const store = readAuthStore();
  const pool = store.credential_pool;
  if (!pool || typeof pool !== "object") return {};
  return pool as Record<string, CredentialEntry[]>;
}

export function setCredentialPool(
  provider: string,
  entries: CredentialEntry[],
): void {
  const store = readAuthStore();
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  writeAuthStore(store);
}
