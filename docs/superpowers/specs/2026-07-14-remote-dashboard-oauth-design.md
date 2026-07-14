# Remote Dashboard OAuth Design

## Goal

Hermes One will connect directly to OAuth-gated remote Hermes dashboards through browser authentication, cookie-authenticated REST requests, and fresh single-use WebSocket tickets.

The feature applies only to direct Remote mode. Local and SSH connection behavior remains unchanged.

## User experience

Hermes One automatically detects the remote gateway authentication mode from the public `GET /api/status` response.

- When `auth_required` is false, Settings retains the existing session-token field and token-based connection behavior.
- When `auth_required` is true, Settings hides the token field and shows remote OAuth state with Sign in and Sign out actions.
- Sign in opens a sandboxed Electron browser window at the gateway `/login` route. The window closes after the gateway callback establishes an OAuth session.
- A cancelled login preserves the remote URL and existing connection configuration.
- An expired session produces a specific reauthentication action instead of starting a local gateway or falling back to the legacy `/v1` transport.

Changing the remote URL refreshes authentication detection. OAuth cookies remain scoped by Electron's cookie jar to their gateway domain.

## Authentication architecture

Remote OAuth uses a dedicated persistent Electron session partition named `persist:hermes-remote-oauth`.

The partition owns all OAuth browser state and HttpOnly gateway session cookies. Cookies, refresh tokens, and reusable authentication material never enter renderer state, `desktop.json`, IPC return values, logs, or analytics.

The main process opens a sandboxed `BrowserWindow` in this partition and navigates to `<gateway>/login`. It observes successful navigations and polls the partition cookie jar until either a Hermes access cookie or refresh cookie exists. The login window uses context isolation, disables Node integration, enables the Chromium sandbox, and retains web security.

A focused `src/main/remote-oauth.ts` module owns:

- persistent partition lookup;
- gateway-scoped cookie presence and removal;
- interactive login-window lifecycle;
- cookie-authenticated JSON requests through Electron `net`;
- single-use WebSocket ticket minting;
- structured OAuth errors, including reauthentication requirements.

## Connection data flow

Settings sends a candidate remote URL to the main process for authentication-mode detection. The main process normalizes the URL and reads public `GET /api/status` without credentials.

For token gateways, existing behavior continues: authenticated REST requests use `X-Hermes-Session-Token`, and the dashboard WebSocket uses `?token=`.

For OAuth gateways:

1. Settings requests interactive sign-in.
2. The main process opens `<gateway>/login` in the dedicated OAuth partition.
3. The identity-provider redirect returns to `/auth/callback`, which writes HttpOnly access and refresh cookies into that partition.
4. Authenticated dashboard REST requests use Electron `net.request` with the same partition and `useSessionCookies: true`.
5. Immediately before every WebSocket connection, the main process sends cookie-authenticated `POST /api/auth/ws-ticket`.
6. The main process returns a fresh `ws://` or `wss://` URL containing only the short-lived `?ticket=` value.
7. The renderer opens the WebSocket and discards the URL after that connection attempt.

The WebSocket URL must be minted per connection, including reconnects. It cannot be cached in `DashboardConnection` because OAuth tickets are short-lived and single-use.

## Configuration and IPC contract

Connection configuration gains a normalized remote authentication mode: `auto`, `token`, or `oauth`. Existing configuration without this field behaves as `auto`.

Automatic mode is authoritative for normal UI use:

- `auto` probes `/api/status` and resolves to token or OAuth behavior;
- `token` and `oauth` exist as normalized internal states for a resolved connection and future diagnostics, not as a manual Settings selector.

Public connection configuration exposes authentication mode and signed-in state, never cookie values.

New preload APIs provide bounded operations:

- probe remote authentication mode;
- start OAuth login;
- sign out from the selected remote gateway;
- query OAuth session state;
- obtain a fresh dashboard WebSocket URL.

Every IPC handler validates and normalizes the remote URL in the main process. Renderer callers cannot select arbitrary session partitions or request cookies.

## Dashboard transport integration

`src/main/dashboard.ts` resolves a remote dashboard connection according to detected authentication mode.

Token connections keep the current `requestJson`, authenticated `/api/sessions` check, and `?token=` WebSocket probe.

OAuth connections use the partition-bound request helper for authenticated endpoints and mint a ticket before WebSocket probing. `DashboardStatus` distinguishes a signed-out OAuth gateway from an unsupported dashboard.

The dashboard renderer requests a fresh WebSocket URL immediately before every `DashboardGatewayClient.connect()` call. A cached token URL remains valid for token mode; OAuth mode always mints another ticket.

OAuth dashboard failure never triggers legacy `/v1` or local-gateway fallback. Those paths use incompatible credentials and could silently route a conversation to the wrong backend.

## Error behavior

Errors remain specific and actionable:

- Closing the login window before cookies appear returns `oauth_cancelled`.
- Missing access and refresh cookies returns `oauth_login_required`.
- HTTP 401 from an authenticated REST or ticket request returns `oauth_login_required` and clears the connected indicator.
- Missing or malformed `/api/auth/ws-ticket` response reports gateway incompatibility and names the endpoint.
- WebSocket rejection requests one new ticket for one retry. A second rejection surfaces the transport error without another fallback or retry loop.
- Network, TLS, and invalid-URL errors preserve their underlying message while adding remote OAuth operation context.

Sign out removes only cookies applicable to the selected gateway URL. It does not clear unrelated gateway, Hermes account, provider OAuth, web-preview, or default-session cookies.

## Testing strategy

Implementation follows test-driven development. Each behavior receives a failing test before production code changes.

Focused tests cover:

- `auth_required` detection and malformed status responses;
- access-cookie and refresh-cookie session recognition;
- gateway-domain cookie scoping and sign-out;
- partition-bound REST requests with session cookies enabled;
- WebSocket ticket response validation;
- a new ticket minted for every connect and reconnect;
- 401 mapping to the structured reauthentication state;
- login cancellation preserving configuration;
- token dashboard behavior remaining unchanged;
- SSH behavior remaining unchanged;
- preload and IPC surface restrictions;
- renderer Settings states for probing, signed out, signing in, connected, cancelled, and expired.

Verification includes focused tests, Node and renderer typechecks, full Vitest suite, production build, and `lat check`. Relevant architecture and test specifications are added to `lat.md/` with source/test references.

## Security boundaries

OAuth secrets stay in Electron's cookie store. The application never reads, serializes, logs, or returns cookie values.

Login content runs with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`. Navigation remains limited to the gateway login flow and identity-provider redirects; popup and external navigation behavior follows explicit allowlisting.

Ticket minting accepts only normalized HTTP(S) gateway URLs. WebSocket URLs are derived from that gateway origin and use `ws:` only for `http:` gateways and `wss:` for `https:` gateways.

## Acceptance criteria

Given a remote URL whose `/api/status` reports `auth_required: true`, Hermes One identifies OAuth mode and offers browser sign-in without requesting a session token.

After successful sign-in, authenticated dashboard REST calls succeed through the persistent OAuth partition, each WebSocket connection receives a newly minted ticket, and chat connects without local or legacy fallback.

After application restart, a still-valid access or refresh cookie restores the connected state without another interactive login.

After session expiry, Hermes One reports that reauthentication is required and does not expose credentials, start a local gateway, or route chat through another backend.

Token-authenticated Remote mode and SSH mode retain their current tested behavior.
