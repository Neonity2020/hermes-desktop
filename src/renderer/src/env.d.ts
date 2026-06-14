/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_HERMES_DESKTOP_APP_NAME?: string;
  readonly VITE_HERMES_DESKTOP_DASHBOARD_CHAT?: string;
  readonly VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
