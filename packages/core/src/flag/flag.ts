import { Config } from "effect"
import { InstallationChannel } from "../installation/version"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

// Channels that default to the new effect-httpapi server backend. The legacy
// hono backend remains the default for stable (`prod`/`latest`) installs.
const HTTPAPI_DEFAULT_ON_CHANNELS = new Set(["dev", "beta", "local"])

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const OCTO_EXPERIMENTAL = truthy("OCTO_EXPERIMENTAL")
const OCTO_DISABLE_CLAUDE_CODE = truthy("OCTO_DISABLE_CLAUDE_CODE")
const OCTO_DISABLE_CLAUDE_CODE_SKILLS =
  OCTO_DISABLE_CLAUDE_CODE || truthy("OCTO_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["OCTO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OCTO_AUTO_SHARE: truthy("OCTO_AUTO_SHARE"),
  OCTO_AUTO_HEAP_SNAPSHOT: truthy("OCTO_AUTO_HEAP_SNAPSHOT"),
  OCTO_GIT_BASH_PATH: process.env["OCTO_GIT_BASH_PATH"],
  OCTO_CONFIG: process.env["OCTO_CONFIG"],
  OCTO_CONFIG_CONTENT: process.env["OCTO_CONFIG_CONTENT"],
  OCTO_DISABLE_AUTOUPDATE: truthy("OCTO_DISABLE_AUTOUPDATE"),
  OCTO_ALWAYS_NOTIFY_UPDATE: truthy("OCTO_ALWAYS_NOTIFY_UPDATE"),
  OCTO_DISABLE_PRUNE: truthy("OCTO_DISABLE_PRUNE"),
  OCTO_DISABLE_TERMINAL_TITLE: truthy("OCTO_DISABLE_TERMINAL_TITLE"),
  OCTO_SHOW_TTFD: truthy("OCTO_SHOW_TTFD"),
  OCTO_PERMISSION: process.env["OCTO_PERMISSION"],
  OCTO_DISABLE_DEFAULT_PLUGINS: truthy("OCTO_DISABLE_DEFAULT_PLUGINS"),
  OCTO_DISABLE_LSP_DOWNLOAD: truthy("OCTO_DISABLE_LSP_DOWNLOAD"),
  OCTO_ENABLE_EXPERIMENTAL_MODELS: truthy("OCTO_ENABLE_EXPERIMENTAL_MODELS"),
  OCTO_DISABLE_AUTOCOMPACT: truthy("OCTO_DISABLE_AUTOCOMPACT"),
  OCTO_DISABLE_MODELS_FETCH: truthy("OCTO_DISABLE_MODELS_FETCH"),
  OCTO_DISABLE_MOUSE: truthy("OCTO_DISABLE_MOUSE"),
  OCTO_DISABLE_CLAUDE_CODE,
  OCTO_DISABLE_CLAUDE_CODE_PROMPT: OCTO_DISABLE_CLAUDE_CODE || truthy("OCTO_DISABLE_CLAUDE_CODE_PROMPT"),
  OCTO_DISABLE_CLAUDE_CODE_SKILLS,
  OCTO_DISABLE_EXTERNAL_SKILLS: truthy("OCTO_DISABLE_EXTERNAL_SKILLS"),
  OCTO_FAKE_VCS: process.env["OCTO_FAKE_VCS"],
  OCTO_SERVER_PASSWORD: process.env["OCTO_SERVER_PASSWORD"],
  OCTO_SERVER_USERNAME: process.env["OCTO_SERVER_USERNAME"],
  OCTO_ENABLE_QUESTION_TOOL: truthy("OCTO_ENABLE_QUESTION_TOOL"),

  // Experimental
  OCTO_EXPERIMENTAL,
  OCTO_EXPERIMENTAL_FILEWATCHER: Config.boolean("OCTO_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OCTO_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OCTO_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OCTO_EXPERIMENTAL_ICON_DISCOVERY: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_ICON_DISCOVERY"),
  OCTO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OCTO_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OCTO_ENABLE_EXA: truthy("OCTO_ENABLE_EXA") || OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_EXA"),
  OCTO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("OCTO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  OCTO_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("OCTO_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  OCTO_EXPERIMENTAL_OXFMT: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_OXFMT"),
  OCTO_EXPERIMENTAL_LSP_TY: truthy("OCTO_EXPERIMENTAL_LSP_TY"),
  OCTO_EXPERIMENTAL_LSP_TOOL: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_LSP_TOOL"),
  OCTO_EXPERIMENTAL_PLAN_MODE: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_PLAN_MODE"),
  OCTO_EXPERIMENTAL_MARKDOWN: !falsy("OCTO_EXPERIMENTAL_MARKDOWN"),
  OCTO_MODELS_URL: process.env["OCTO_MODELS_URL"],
  OCTO_MODELS_PATH: process.env["OCTO_MODELS_PATH"],
  OCTO_DISABLE_EMBEDDED_WEB_UI: truthy("OCTO_DISABLE_EMBEDDED_WEB_UI"),
  OCTO_DB: process.env["OCTO_DB"],
  OCTO_DISABLE_CHANNEL_DB: truthy("OCTO_DISABLE_CHANNEL_DB"),
  OCTO_SKIP_MIGRATIONS: truthy("OCTO_SKIP_MIGRATIONS"),
  OCTO_STRICT_CONFIG_DEPS: truthy("OCTO_STRICT_CONFIG_DEPS"),

  OCTO_WORKSPACE_ID: process.env["OCTO_WORKSPACE_ID"],
  // Defaults to true on dev/beta/local channels so internal users exercise the
  // new effect-httpapi server backend. Stable (`prod`/`latest`) installs stay
  // on the legacy hono backend until the rollout is complete. An explicit env
  // var ("true"/"1" or "false"/"0") always wins, providing an opt-in for
  // stable users and an escape hatch for dev/beta users.
  OCTO_EXPERIMENTAL_HTTPAPI:
    truthy("OCTO_EXPERIMENTAL_HTTPAPI") ||
    (!falsy("OCTO_EXPERIMENTAL_HTTPAPI") && HTTPAPI_DEFAULT_ON_CHANNELS.has(InstallationChannel)),
  OCTO_EXPERIMENTAL_WORKSPACES: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_WORKSPACES"),
  OCTO_EXPERIMENTAL_EVENT_SYSTEM: OCTO_EXPERIMENTAL || truthy("OCTO_EXPERIMENTAL_EVENT_SYSTEM"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OCTO_DISABLE_PROJECT_CONFIG() {
    return truthy("OCTO_DISABLE_PROJECT_CONFIG")
  },
  get OCTO_TUI_CONFIG() {
    return process.env["OCTO_TUI_CONFIG"]
  },
  get OCTO_CONFIG_DIR() {
    return process.env["OCTO_CONFIG_DIR"]
  },
  get OCTO_PURE() {
    return truthy("OCTO_PURE")
  },
  get OCTO_PLUGIN_META_FILE() {
    return process.env["OCTO_PLUGIN_META_FILE"]
  },
  get OCTO_CLIENT() {
    return process.env["OCTO_CLIENT"] ?? "cli"
  },
}
