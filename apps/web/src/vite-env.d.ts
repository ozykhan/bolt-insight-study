/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly POSTHOG_PROJECT_KEY?: string;
  readonly POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
