import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { mcpEntryToFormState, validateMcpForm, type McpFormType } from "./dialog-mcp-form-validation"

type Props = {
  editing?: { name: string; entry: Record<string, unknown> }
  existingNames: ReadonlySet<string>
  onSubmit: (name: string, value: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

type WizardState = {
  command: string
  args: string
  environment: string
  url: string
  headers: string
}

const MCP_NAME_PRESETS = ["custom", "fetch", "time", "memory", "context7"] as const
type McpNamePreset = (typeof MCP_NAME_PRESETS)[number]

const JSON_PLACEHOLDER: Record<McpFormType, string> = {
  stdio: `{
  "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
  "environment": { "KEY": "value" },
  "timeout": 5000
}`,
  http: `{
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer xxx" }
}`,
  sse: `{
  "url": "https://example.com/sse"
}`,
}

const presetFromName = (name: string): McpNamePreset =>
  MCP_NAME_PRESETS.find((preset) => preset !== "custom" && preset === name) ?? "custom"

const wizardStateFromJson = (json: string): WizardState => {
  try {
    const value = JSON.parse(json) as Record<string, unknown>
    const command = Array.isArray(value.command)
      ? value.command.filter((item): item is string => typeof item === "string")
      : []
    const environment =
      typeof value.environment === "object" && value.environment !== null && !Array.isArray(value.environment)
        ? Object.entries(value.environment)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(([key, item]) => `${key}=${item}`)
            .join("\n")
        : ""
    const headers =
      typeof value.headers === "object" && value.headers !== null && !Array.isArray(value.headers)
        ? Object.entries(value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(([key, item]) => `${key}: ${item}`)
            .join("\n")
        : ""
    return {
      command: command[0] ?? "",
      args: command.slice(1).join("\n"),
      environment,
      url: typeof value.url === "string" ? value.url : "",
      headers,
    }
  } catch {
    return { command: "", args: "", environment: "", url: "", headers: "" }
  }
}

const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)

const keyValueLines = (value: string, separator: string) =>
  Object.fromEntries(
    lines(value)
      .map((item) => {
        const index = item.indexOf(separator)
        if (index < 1) return
        return [item.slice(0, index).trim(), item.slice(index + separator.length).trim()] as const
      })
      .filter((item): item is readonly [string, string] => !!item),
  )

const wizardJson = (type: McpFormType, wizard: WizardState) =>
  JSON.stringify(
    type === "stdio"
      ? {
          command: [wizard.command.trim(), ...lines(wizard.args)].filter(Boolean),
          ...(wizard.environment.trim() ? { environment: keyValueLines(wizard.environment, "=") } : {}),
        }
      : {
          url: wizard.url.trim(),
          ...(wizard.headers.trim() ? { headers: keyValueLines(wizard.headers, ":") } : {}),
        },
    null,
    2,
  )

const inferType = (json: string, fallback: McpFormType) => {
  try {
    const value = JSON.parse(json) as Record<string, unknown>
    if (Array.isArray(value.command)) return "stdio" as const
    if (value.transport === "sse") return "sse" as const
    if (value.transport === "http") return "http" as const
    if (typeof value.url === "string") return fallback === "sse" ? "sse" : "http"
    return fallback
  } catch {
    return fallback
  }
}

function WizardField(props: { label: string; required?: boolean; error?: string; children: JSX.Element }) {
  return (
    <label class="flex w-full flex-col gap-2 text-12-medium text-[rgba(0,0,0,0.9)]">
      <span>
        {props.label}{" "}
        <Show when={props.required}>
          <span class="text-[#E02128]">*</span>
        </Show>
      </span>
      {props.children}
      <Show when={props.error}>
        <span class="text-11-regular text-text-danger-base">{props.error}</span>
      </Show>
    </label>
  )
}

function WizardTextarea(props: { placeholder: string; value: string; onInput: (value: string) => void }) {
  return (
    <textarea
      class="h-[68px] w-full resize-none rounded-[4px] border border-[rgba(0,0,0,0.25)] bg-white px-3 py-1 text-12-regular leading-5 text-[rgba(0,0,0,0.9)] outline-none placeholder:text-[rgba(0,0,0,0.3)] focus:border-[#0A59F7]"
      spellcheck={false}
      placeholder={props.placeholder}
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  )
}

export function DialogMcpForm(props: Props) {
  const language = useLanguage()
  const [saving, setSaving] = createSignal(false)
  const [page, setPage] = createSignal<"json" | "wizard">("json")
  const initial = props.editing
    ? mcpEntryToFormState(props.editing.name, props.editing.entry)
    : { name: "", type: "http" as McpFormType, json: "", homepage: "", docs: "" }
  const [form, setForm] = createStore({ ...initial, err: {} as ReturnType<typeof validateMcpForm>["errors"] })
  const [wizard, setWizard] = createStore(wizardStateFromJson(initial.json))

  const setField = (key: "name" | "json" | "homepage" | "docs", value: string) => {
    setForm(key, value)
    setForm("err", key, undefined)
  }

  const selectNamePreset = (value: McpNamePreset) => {
    if (props.editing) return
    setField("name", value === "custom" ? "" : value)
  }

  const openWizard = () => {
    setForm("type", inferType(form.json, form.type))
    setWizard(wizardStateFromJson(form.json))
    setPage("wizard")
  }

  const closeWizard = () => {
    setField("json", wizardJson(form.type, wizard))
    setPage("json")
  }

  const validationForm = () =>
    page() === "wizard"
      ? { ...form, json: wizardJson(form.type, wizard) }
      : { ...form, type: inferType(form.json, form.type) }

  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    if (saving()) return
    const { errors, result } = validateMcpForm({
      form: validationForm(),
      t: language.t,
      existingNames: props.existingNames,
    })
    setForm("err", errors)
    if (!result) return
    setSaving(true)
    try {
      await props.onSubmit(result.name, result.value)
      props.onClose()
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form data-mcp-form onSubmit={save} class="flex h-full min-h-0 flex-col">
      <style>{`
        [data-mcp-form] [data-slot="input-label"] {
          color: rgba(0, 0, 0, 0.9) !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          line-height: 20px !important;
        }
        [data-mcp-save]:not(:disabled) {
          background-color: #0a59f7 !important;
          color: #ffffff !important;
        }
      `}</style>
      <div class="flex items-center gap-1 py-3">
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-[4px] text-text-strong hover:bg-[rgba(25,25,25,0.05)]"
          aria-label={language.t("settings.mcp.form.back")}
          onClick={() => (page() === "wizard" ? closeWizard() : props.onClose())}
        >
          <img src="/setting/chevronBackward.svg" width={16} height={16} alt="" />
        </button>
        <h2 class="text-14-medium text-text-strong">
          {language.t(
            page() === "wizard"
              ? "settings.mcp.form.back.short"
              : props.editing
                ? "settings.mcp.form.title.edit"
                : "settings.mcp.form.title.add",
          )}
        </h2>
      </div>

      <div class="no-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
        <Show
          when={page() === "json"}
          fallback={
            <div class="flex flex-col gap-4">
              <div class="flex h-11 flex-col justify-center gap-0.5">
                <h3 class="text-14-medium text-[rgba(0,0,0,0.9)]">{language.t("settings.mcp.form.wizard.title")}</h3>
                <p class="text-12-regular text-[rgba(0,0,0,0.6)]">
                  {language.t("settings.mcp.form.wizard.description")}
                </p>
              </div>
              <div class="flex flex-col gap-6">
                <fieldset class="flex flex-col gap-2">
                  <legend class="text-12-medium text-[rgba(0,0,0,0.9)]">
                    {language.t("settings.mcp.form.field.type.label")} <span class="text-[#E02128]">*</span>
                  </legend>
                  <div class="flex h-[22px] items-center gap-4">
                    {(["stdio", "http", "sse"] as const).map((value) => (
                      <label class="flex cursor-pointer items-center gap-2 text-12-regular text-[rgba(0,0,0,0.9)]">
                        <input
                          type="radio"
                          name="mcp-wizard-type"
                          value={value}
                          checked={form.type === value}
                          onChange={() => {
                            setForm("type", value)
                            setForm("err", "json", undefined)
                          }}
                          class="size-4 cursor-pointer accent-[#0A59F7]"
                        />
                        {language.t(`settings.mcp.type.${value}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <WizardField
                  label={language.t("settings.mcp.form.field.wizardName.label")}
                  required
                  error={form.err.name}
                >
                  <input
                    autofocus
                    required
                    readOnly={!!props.editing}
                    class="h-7 w-full rounded-[4px] border border-[rgba(0,0,0,0.25)] bg-white px-3 text-12-regular text-[rgba(0,0,0,0.9)] outline-none placeholder:text-[rgba(0,0,0,0.3)] focus:border-[#0A59F7] read-only:bg-[rgba(25,25,25,0.03)]"
                    placeholder="my-mcp-server"
                    value={form.name}
                    onInput={(event) => setField("name", event.currentTarget.value)}
                  />
                </WizardField>

                <Show
                  when={form.type === "stdio"}
                  fallback={
                    <>
                      <WizardField label="URL" required error={form.err.json}>
                        <input
                          required
                          type="url"
                          class="h-7 w-full rounded-[4px] border border-[rgba(0,0,0,0.25)] bg-white px-3 text-12-regular text-[rgba(0,0,0,0.9)] outline-none placeholder:text-[rgba(0,0,0,0.3)] focus:border-[#0A59F7]"
                          placeholder="https://api.example.com/mcp"
                          value={wizard.url}
                          onInput={(event) => {
                            setWizard("url", event.currentTarget.value)
                            setForm("err", "json", undefined)
                          }}
                        />
                      </WizardField>
                      <WizardField label={language.t("settings.mcp.form.field.headers.label")}>
                        <WizardTextarea
                          placeholder={"Authorization: Bearer your_token_here\nContent-Type: application/json"}
                          value={wizard.headers}
                          onInput={(value) => setWizard("headers", value)}
                        />
                      </WizardField>
                    </>
                  }
                >
                  <WizardField
                    label={language.t("settings.mcp.form.field.command.label")}
                    required
                    error={form.err.json}
                  >
                    <input
                      required
                      class="h-7 w-full rounded-[4px] border border-[rgba(0,0,0,0.25)] bg-white px-3 text-12-regular text-[rgba(0,0,0,0.9)] outline-none placeholder:text-[rgba(0,0,0,0.3)] focus:border-[#0A59F7]"
                      placeholder={language.t("settings.mcp.form.field.command.placeholder")}
                      value={wizard.command}
                      onInput={(event) => {
                        setWizard("command", event.currentTarget.value)
                        setForm("err", "json", undefined)
                      }}
                    />
                  </WizardField>
                  <WizardField label={language.t("settings.mcp.form.field.args.label")}>
                    <WizardTextarea
                      placeholder={"arg1\narg2"}
                      value={wizard.args}
                      onInput={(value) => setWizard("args", value)}
                    />
                  </WizardField>
                  <WizardField label={language.t("settings.mcp.form.field.environment.label")}>
                    <WizardTextarea
                      placeholder={"KEY1=value1\nKEY1=value2"}
                      value={wizard.environment}
                      onInput={(value) => setWizard("environment", value)}
                    />
                  </WizardField>
                </Show>
              </div>
            </div>
          }
        >
          <div class="flex flex-col gap-5 rounded-[14px] border border-[rgba(0,0,0,0.1)] p-5">
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-[rgba(0,0,0,0.9)]">
                {language.t("settings.mcp.form.template.label")} <span class="text-[#E02128]">*</span>
              </label>
              <div class="flex flex-wrap gap-3">
                {MCP_NAME_PRESETS.map((value) => (
                  <button
                    type="button"
                    class="h-8 rounded-[4px] px-4 text-14-regular"
                    classList={{
                      "bg-[rgba(10,89,247,0.05)] text-[#0A59F7]": presetFromName(form.name) === value,
                      "bg-[rgba(25,25,25,0.05)] text-[#191919]": presetFromName(form.name) !== value,
                    }}
                    onClick={() => selectNamePreset(value)}
                  >
                    {language.t(`settings.mcp.form.template.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-[rgba(0,0,0,0.9)]">
                {language.t("settings.mcp.form.field.name.label")} <span class="text-[#E02128]">*</span>
              </label>
              <TextField
                autofocus
                required
                hideLabel
                label={language.t("settings.mcp.form.field.name.label")}
                placeholder="MCP server name"
                value={form.name}
                onChange={(value) => setField("name", value)}
                readOnly={!!props.editing}
                validationState={form.err.name ? "invalid" : undefined}
                error={form.err.name}
              />
            </div>
            <TextField
              label={language.t("settings.mcp.form.field.homepage.label")}
              placeholder="https://example.com"
              value={form.homepage}
              onChange={(value) => setField("homepage", value)}
              validationState={form.err.homepage ? "invalid" : undefined}
              error={form.err.homepage}
            />
            <TextField
              label={language.t("settings.mcp.form.field.docs.label")}
              placeholder="https://example.com/docs"
              value={form.docs}
              onChange={(value) => setField("docs", value)}
              validationState={form.err.docs ? "invalid" : undefined}
              error={form.err.docs}
            />
          </div>

          <div class="flex flex-col gap-2 rounded-[14px] border border-[rgba(0,0,0,0.1)] p-5">
            <div class="flex items-center justify-between gap-3">
              <label class="text-12-medium text-[rgba(0,0,0,0.9)]">{language.t("settings.mcp.form.json.full")}</label>
              <button type="button" class="text-12-medium text-[#0A59F7]" onClick={openWizard}>
                {language.t("settings.mcp.form.wizard")}
              </button>
            </div>
            <textarea
              class="w-full rounded-[4px] border border-border-weak-base bg-[#F7F7F9] px-3 py-2 font-mono text-13-regular text-text-base outline-none focus:border-border-strong-base"
              style={{ "min-height": "260px", resize: "vertical" }}
              spellcheck={false}
              placeholder={JSON_PLACEHOLDER[form.type]}
              value={form.json}
              onInput={(event) => setField("json", event.currentTarget.value)}
            />
            <Show when={form.err.json}>
              <span class="text-11-regular text-text-danger-base">{form.err.json}</span>
            </Show>
          </div>
        </Show>
      </div>

      <div class="-mx-5 -mb-2 flex h-[52px] shrink-0 items-center justify-end border-t border-[rgba(0,0,0,0.1)] bg-white px-5">
        <Button
          data-mcp-save
          type="submit"
          size="normal"
          variant="primary"
          class="min-w-[72px] rounded-[4px]"
          disabled={saving()}
        >
          {saving() ? language.t("common.saving") : language.t("common.save")}
        </Button>
      </div>
    </form>
  )
}
