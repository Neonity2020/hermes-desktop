/**
 * Shared types for the "Discover" community marketplace. The catalog is served
 * from the hermes-registry GitHub repo and consumed by both the main process
 * (fetch + install) and the renderer (browse UI).
 */

export type RegistryKind = "skills" | "mcps" | "agents" | "workflows";

export interface RegistryItem {
  /** Stable identifier, unique within its kind. */
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  version?: string;
  /** Skill: install identifier passed to `hermes skills install`. */
  source?: string;
  /** MCP: transport + connection config written into config.yaml. */
  transport?: "http" | "stdio";
  config?: {
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
  };
  /** Agent: optional model/provider hints shown in the card. */
  model?: string;
  provider?: string;
  /** Workflow: URL (absolute, or relative to the registry repo) of the script. */
  scriptUrl?: string;
  scriptPath?: string;
}

export interface RegistryCatalog {
  skills: RegistryItem[];
  mcps: RegistryItem[];
  agents: RegistryItem[];
  workflows: RegistryItem[];
}

export interface InstalledRegistry {
  skills: string[];
  mcps: string[];
  workflows: string[];
}
