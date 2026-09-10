import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { DialogSettings } from "./dialog-settings"
import { mcpEntryToFormState, validateMcpForm, type McpFormType } from "./dialog-mcp-form-validation"

type Props = {
  editing?: { name: string; entry: Record<string, unknown> }
  existingNames: ReadonlySet<string>
  onSubmit: (name: string, value: Record<string, unknown>) => Promise<void>
}

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

export function DialogMcpForm(props: Props) {
  const dialog = useDialog()
  const language = useLanguage()
  const [saving, setSaving] = createSignal(false)

  const initial = props.editing
    ? mcpEntryToFormState(props.editing.name, props.editing.entry)
    : { name: "", type: "http" as McpFormType, json: "", homepage: "", docs: "" }
  const [form, setForm] = createStore({ ...initial, err: {} as ReturnType<typeof validateMcpForm>["errors"] })

  const typeOptions = createMemo(() =>
    (["stdio", "http", "sse"] as const).map((value) => ({
      value,
      label:
        value === "stdio"
          ? language.t("settings.mcp.type.stdio")
          : value === "http"
            ? language.t("settings.mcp.type.http")
            : language.t("settings.mcp.type.sse"),
    })),
  )

  const setField = (key: "name" | "json" | "homepage" | "docs", value: string) => {
    setForm(key, value)
    setForm("err", key, undefined)
  }

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    if (saving()) return
    const { errors, result } = validateMcpForm({ form, t: language.t, existingNames: props.existingNames })
    setForm("err", errors)
    if (!result) return
    setSaving(true)
    try {
      await props.onSubmit(result.name, result.value)
      dialog.show(() => <DialogSettings initialTab="mcp" />)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={language.t(props.editing ? "settings.mcp.form.title.edit" : "settings.mcp.form.title.add")}
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[70vh]">
        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <div class="flex flex-col gap-4">
            <TextField
              autofocus
              label={language.t("settings.mcp.form.field.name.label")}
              placeholder={language.t("settings.mcp.form.field.name.placeholder")}
              description={language.t("settings.mcp.form.field.name.description")}
              value={form.name}
              onChange={(v) => setField("name", v)}
              readOnly={!!props.editing}
              validationState={form.err.name ? "invalid" : undefined}
              error={form.err.name}
            />

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-weak">{language.t("settings.mcp.form.field.type.label")}</label>
              <Select
                options={typeOptions()}
                current={typeOptions().find((o) => o.value === form.type)}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && setForm("type", option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "180px" }}
                disabled={!!props.editing}
              />
              <Show when={form.type !== "stdio"}>
                <span class="text-11-regular text-text-weaker">{language.t("settings.mcp.form.hint.transport")}</span>
              </Show>
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-weak">{language.t("settings.mcp.form.field.json.label")}</label>
              <textarea
                class="w-full rounded-md border border-border-weak-base bg-bg-base px-3 py-2 font-mono text-13-regular text-text-base outline-none focus:border-border-strong-base"
                style={{ "min-height": "120px", resize: "vertical" }}
                spellcheck={false}
                placeholder={JSON_PLACEHOLDER[form.type]}
                value={form.json}
                onInput={(e) => setField("json", e.currentTarget.value)}
              />
              <Show when={form.err.json}>
                <span class="text-11-regular text-text-danger-base">{form.err.json}</span>
              </Show>
            </div>

            <TextField
              label={language.t("settings.mcp.form.field.homepage.label")}
              placeholder="https://example.com"
              value={form.homepage}
              onChange={(v) => setField("homepage", v)}
              validationState={form.err.homepage ? "invalid" : undefined}
              error={form.err.homepage}
            />
            <TextField
              label={language.t("settings.mcp.form.field.docs.label")}
              placeholder="https://example.com/docs"
              value={form.docs}
              onChange={(v) => setField("docs", v)}
              validationState={form.err.docs ? "invalid" : undefined}
              error={form.err.docs}
            />
          </div>

          <div class="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="large"
              onClick={() => dialog.show(() => <DialogSettings initialTab="mcp" />)}
            >
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" size="large" variant="primary" disabled={saving()}>
              {saving() ? language.t("common.saving") : language.t("common.submit")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
