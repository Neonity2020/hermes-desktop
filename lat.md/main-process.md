# Main Process

The Electron main process keeps the entrypoint small and separates app lifecycle from IPC registration.

## Entrypoint

`src/main/index.ts` performs only pre-ready setup and delegates startup.

[[src/main/index.ts]] applies GPU crash preferences, enables the optional CDP testing port, and calls [[src/main/app/start.ts#startMainProcess]]. This keeps one-off process boot concerns separate from windows, menus, updater wiring, and IPC.

## GPU Fallback

Hardware acceleration is disabled and persisted after a GPU-process crash so machines without a usable GPU (VMs, virtual display adapters) avoid an infinite crash → relaunch loop.

[[src/main/gpu-fallback.ts#applyGpuPreferences]] disables hardware acceleration when a crash flag, relaunch sentinel, or `HERMES_DISABLE_GPU` says so, while keeping SwiftShader WebGL available. Persistent GPU-off fallback is honored by default on Windows/Linux, but macOS clears stale flags unless `HERMES_GPU_FALLBACK=1` forces it, protecting the Office tab from permanent software-rendering lag. [[src/main/gpu-fallback.ts#installGpuCrashGuard]] watches fatal GPU-process exits and relaunches with software rendering where the persistent fallback is enabled.

## App Lifecycle

Lifecycle code owns Electron windows, global app events, and shutdown cleanup.

[[src/main/app/start.ts#startMainProcess]] registers crash logging, IPC handlers, updater handlers, Electron ready/activate/window-all-closed/before-quit events, CSP headers, security hardening, and the main BrowserWindow.

[[src/main/app/start.ts]] also supports the `HERMES_OPEN_DEVTOOLS=1` diagnostic launch path so packaged builds can expose renderer console errors when startup fails before the UI paints.

The packaged renderer keeps its meta CSP aligned with the production response CSP so file-backed startup assets load consistently from `file://` before the main-process header can help.

Because electron-vite emits a bundled main file at `out/main/index.js`, packaged renderer loading resolves `../renderer/index.html` from `__dirname` to reach `out/renderer/index.html`.

## App Chrome Helpers

Menu, updater, and context-menu behavior live in focused modules.

[[src/main/app/menu.ts#buildMenu]] owns the application menu, [[src/main/app/updater.ts#setupUpdater]] owns update IPC and electron-updater events, and [[src/main/app/context-menu.ts#showChatContextMenu]] owns the chat right-click menu.

Release builds keep a Help-menu Developer Tools toggle as a production diagnostics escape hatch without changing renderer sandbox or Node isolation.

## IPC Registry

Renderer IPC handlers are isolated from app bootstrap so the registry can be split by domain.

[[src/main/ipc/register.ts#registerIpcHandlers]] currently preserves the existing handler behavior behind one registration function. It receives app-level callbacks for the main window, model-library notifications, connection-config notifications, external URL opening, and active chat abort handles.

Wallet and token-balance handlers sit in the same registry: `list-wallets`, `create-wallet`, `import-wallet`, `rename-wallet`, `delete-wallet` (backed by [[wallet-token-balances#Wallet Store]]) and `get-token-balances` (backed by [[wallet-token-balances#Token Balances]]).

## Voice transcription IPC

Speech-to-text IPC sends recorded desktop audio through the Hermes API server, not through the active chat model endpoint.

[[src/main/ipc/register.ts#registerIpcHandlers]] exposes `transcribe-audio` for the preload bridge, and [[src/main/hermes.ts#transcribeAudio]] posts a base64 data URL to `/api/audio/transcribe`. If the local gateway lacks that desktop route, it falls back to the Python `tools.transcription_tools.transcribe_audio` dispatcher, so local Whisper, Groq, OpenAI, ElevenLabs, and command/plugin STT providers remain independent from the selected chat model.

## SSH dashboard transport

SSH mode starts `hermes dashboard` on the remote and tunnels to it, giving full local parity (model library, profile switching, session history, embedded-chat WS) instead of the gateway-only subset.

The dashboard is a **superset** of the gateway api_server: it serves `/v1` + `/health` AND the full `/api/*` set + the chat WS (`/api/ws`), so one tunnel covers every transport. [[src/main/ssh-remote.ts#sshEnsureDashboard]] ensures the gateway is up (messaging/cron; the dashboard may proxy `/v1` to it), builds the web dist if it is missing ([[src/main/ssh-remote.ts#sshEnsureDashboardDist]] — the installer vendors Node at `~/.hermes/node` and the web workspace deps, so a fresh install that never built the dashboard UI is auto-provisioned via `npm run build -w web` on first connect, with a single shared in-flight build), then starts `hermes dashboard --host 127.0.0.1 --port <port> --no-open --skip-build` ([[src/main/ssh-remote.ts#sshStartDashboard]]) with the session token in its env. Readiness requires both the public `/api/status` probe ([[src/main/ssh-remote.ts#sshWaitDashboardReady]], [[src/main/ssh-remote.ts#sshDashboardRunning]]) and an authenticated `/api/sessions` probe ([[src/main/ssh-remote.ts#sshDashboardAuthenticated]]). If the preferred port belongs to a stale dashboard with another token or an unrelated HTTP service, the desktop leaves that process alone, allocates a free loopback port, and persists it as `HERMES_DESKTOP_DASHBOARD_PORT` in the profile `.env`; later IPC calls and app restarts therefore reuse the token-matched dashboard instead of producing `/api/*` 401s followed by legacy-chat 405s. [[src/main/dashboard.ts#sshDashboardConnectionFromConfig]] and [[src/main/ipc/register.ts#getSshDashboardSessionConfig]] then `ensureSshTunnel` to the dashboard port and build the connection. **Every** SSH tunnel entry point that prepares chat — the `send-message` preamble and the `start-ssh-tunnel` IPC handler — routes through [[src/main/ipc/register.ts#prepareSshTunnel]], which targets that same dashboard port and caches the dashboard token (falling back to the gateway port + api_server key only when no authenticated dashboard is available). This is essential: the tunnel is a single global resource, so a path that tunnelled to the gateway port (8642) while another used the dashboard port (9119) would thrash it (each `startSshTunnel` first `stopSshTunnel`s), surfacing as "SSH tunnel is not active". The dashboard requires Node on the remote (the `hermes_cli/web_dist` is built automatically on first connect, above); when it still can't run — no Node, or the build/start fails — `sshEnsureDashboard` returns `null` and callers fall back to the gateway-only legacy path — `auto` transport degrades quietly (and `withSshDashboardModelLibrary`/`withSshDashboardSessions` use the legacy ops), while a forced `dashboard` transport surfaces the error. The old gateway-embedded approach (patch `web_server.py` via `ensureSshDashboardCompatibility`, stop/restart the gateway) is removed — the real dashboard serves `/api/model/*` natively, eliminating that churn.

## SSH credential resolution

When connected through the dashboard, the **dashboard session token** — not the gateway api_server key — is the SSH credential.

The dashboard's `/api/*` routes reject the api_server key (401) and accept only `HERMES_DASHBOARD_SESSION_TOKEN`; its `/v1` accepts that token too, so a single token authenticates everything over the one tunnel. [[src/main/ssh-remote.ts#sshEnsureDashboardToken]] reads the token from the remote `.env` (per profile), generating + persisting one when absent so it stays stable across reconnects and is shared by the remote dashboard process and the desktop. The desktop caches it via `setSshRemoteApiKey`. The SSH form has no API-key field (only **remote** mode does, [[src/renderer/src/components/settings/ConnectionPane.tsx]]), so the shared `conn.apiKey` is never used for SSH — avoiding the stale-key 401s the old `conn.apiKey || …` precedence caused. On the gateway-only fallback path the credential is instead the remote `API_SERVER_KEY` ([[src/main/ssh-remote.ts#sshReadRemoteApiKey]]).
