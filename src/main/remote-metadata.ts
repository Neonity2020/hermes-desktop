import http from "http";
import https from "https";
import type { RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;

function normalizeRemoteDashboardBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Remote Hermes dashboard URL is not configured.");
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname === "/v1" || url.pathname === "/api") {
    url.pathname = "";
  }
  return url.toString().replace(/\/+$/, "");
}

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function remoteStatus(config: RemoteSessionConfig): Promise<RemoteRecord> {
  return new Promise((resolve, reject) => {
    const base = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
    const parsed = new URL("/api/status", `${base}/`);
    const client = parsed.protocol === "https:" ? https : http;
    const token = config.apiKey.trim();
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Hermes-Session-Token": token } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`${res.statusCode}: ${text || res.statusMessage}`));
            return;
          }
          try {
            resolve(asRecord(JSON.parse(text || "{}")));
          } catch {
            reject(new Error(`Invalid JSON from ${parsed.toString()}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("Timed out connecting to remote Hermes dashboard"));
    });
    req.end();
  });
}

export async function remoteGetHermesHome(
  config: RemoteSessionConfig,
): Promise<string> {
  const status = await remoteStatus(config);
  return stringValue(status.hermes_home) || stringValue(status.home) || "";
}

export async function remoteGetHermesVersion(
  config: RemoteSessionConfig,
): Promise<string | null> {
  const status = await remoteStatus(config);
  const version = stringValue(status.version);
  if (!version) return null;

  const releaseDate = stringValue(status.release_date);
  const project =
    stringValue(status.project) ||
    stringValue(status.repo_path) ||
    stringValue(status.config_path);
  const python = stringValue(status.python) || stringValue(status.python_version);
  const sdk =
    stringValue(status.openai_sdk) || stringValue(status.openai_sdk_version);
  const update =
    stringValue(status.update_available) || stringValue(status.update_info);

  const lines = [
    `Hermes Agent v${version}${releaseDate ? ` (${releaseDate})` : ""}`,
    project ? `Project: ${project}` : "",
    python ? `Python: ${python}` : "",
    sdk ? `OpenAI SDK: ${sdk}` : "",
    update ? `Update available: ${update}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
