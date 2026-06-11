import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OCTO__?: {
      deepLinks?: string[]
    }
  }
}

interface ImportMetaEnv {
  readonly VITE_OCTO_BASE_URL: string
  readonly VITE_OCTO_REPORT_BASE_URL: string
  readonly VITE_OCTO_UPLOAD_ENDPOINT?: string

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
