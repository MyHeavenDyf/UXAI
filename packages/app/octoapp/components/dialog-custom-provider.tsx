import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type FormState, headerRow, modalityRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
  providerID?: string
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const current = props.providerID ? globalSync.data.config.provider?.[props.providerID] : undefined
  const currentModels = Object.entries(current?.models ?? {})
  const currentHeaders =
    current?.options?.headers && typeof current.options.headers === "object" && !Array.isArray(current.options.headers)
      ? Object.entries(current.options.headers).filter((item): item is [string, string] => typeof item[1] === "string")
      : []

  const [form, setForm] = createStore<FormState>({
    providerID: props.providerID ?? "",
    name: current?.name ?? "",
    baseURL: typeof current?.options?.baseURL === "string" ? current.options.baseURL : "",
    apiKey: current?.env?.[0] ? `{env:${current.env[0]}}` : "",
    models:
      currentModels.length > 0
        ? currentModels.map(([id, model]) => ({
            row: modelRow().row,
            id,
            name: model.name ?? id,
            modalities: Object.entries(model.modalities ?? {}).map(([key, value]) =>
              modalityRow(key, JSON.stringify(value)),
            ),
            err: { modalities: [] },
          }))
        : [modelRow()],
    headers:
      currentHeaders.length > 0
        ? currentHeaders.map(([key, value]) => ({ ...headerRow(), key, value }))
        : [headerRow()],
    err: {},
  })

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const addModality = (modelIndex: number) => {
    setForm(
      "models",
      modelIndex,
      "modalities",
      produce((rows) => {
        rows.push(modalityRow())
      }),
    )
  }

  const removeModality = (modelIndex: number, index: number) => {
    setForm(
      "models",
      modelIndex,
      "modalities",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setModality = (modelIndex: number, index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("models", modelIndex, "modalities", index, key, value)
      setForm("models", modelIndex, "modalities", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(globalSync.data.provider.all.map((p) => p.id)),
      editingProviderID: props.providerID,
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => {
        setForm("models", index, "err", err)
        err.modalities.forEach((item, modalityIndex) =>
          setForm("models", index, "modalities", modalityIndex, "err", item),
        )
      })
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      const existing = globalSync.data.config.provider?.[result.providerID]
      const models = Object.fromEntries(
        Object.entries(result.config.models).map(([id, model]) => {
          const { modalities: _, ...before } = existing?.models?.[id] ?? {}
          return [id, { ...before, ...model }]
        }),
      )
      const { baseURL: _, headers: __, ...options } = existing?.options ?? {}

      await globalSDK.client.global.config.replaceProvider({
        providerID: result.providerID,
        providerConfig: {
          ...existing,
          ...result.config,
          ...(result.key ? { env: [] } : {}),
          options: {
            ...options,
            ...result.config.options,
          },
          models,
        },
      })
      if (nextDisabled.length !== disabledProviders.length) {
        await globalSync.updateConfig({ disabled_providers: nextDisabled })
      }
      return result
    },
    onSuccess: (result) => {
      globalSync.invalidateProviders()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("provider.custom.description.prefix")}
            <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </Link>
            {language.t("provider.custom.description.suffix")}
          </p>

          <div class="flex flex-col gap-4">
            <TextField
              autofocus
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(v) => setField("providerID", v)}
              readOnly={!!props.providerID}
              validationState={form.err.providerID ? "invalid" : undefined}
              error={form.err.providerID}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={(v) => setField("name", v)}
              validationState={form.err.name ? "invalid" : undefined}
              error={form.err.name}
            />
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(v) => setField("baseURL", v)}
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t(
                props.providerID
                  ? "provider.custom.field.apiKey.editDescription"
                  : "provider.custom.field.apiKey.description",
              )}
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
            />
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
            <For each={form.models}>
              {(m, i) => (
                <div class="flex flex-col gap-3 rounded-md border border-border-weak-base p-3" data-row={m.row}>
                  <div class="flex gap-2 items-start">
                    <div class="flex-1">
                      <TextField
                        label={language.t("provider.custom.models.id.label")}
                        hideLabel
                        placeholder={language.t("provider.custom.models.id.placeholder")}
                        value={m.id}
                        onChange={(v) => setModel(i(), "id", v)}
                        validationState={m.err.id ? "invalid" : undefined}
                        error={m.err.id}
                      />
                    </div>
                    <div class="flex-1">
                      <TextField
                        label={language.t("provider.custom.models.name.label")}
                        hideLabel
                        placeholder={language.t("provider.custom.models.name.placeholder")}
                        value={m.name}
                        onChange={(v) => setModel(i(), "name", v)}
                        validationState={m.err.name ? "invalid" : undefined}
                        error={m.err.name}
                      />
                    </div>
                    <IconButton
                      type="button"
                      icon="trash"
                      variant="ghost"
                      class="mt-1.5"
                      onClick={() => removeModel(i())}
                      disabled={form.models.length <= 1}
                      aria-label={language.t("provider.custom.models.remove")}
                    />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-12-medium text-text-weak">
                      {language.t("provider.custom.models.modalities.label")}
                    </label>
                    <For each={m.modalities}>
                      {(item, modalityIndex) => (
                        <div class="flex gap-2 items-start" data-row={item.row}>
                          <div class="w-1/3">
                            <TextField
                              label={language.t("provider.custom.models.modalities.key.label")}
                              hideLabel
                              placeholder={language.t("provider.custom.models.modalities.key.placeholder")}
                              value={item.key}
                              onChange={(value) => setModality(i(), modalityIndex(), "key", value)}
                              validationState={item.err.key ? "invalid" : undefined}
                              error={item.err.key}
                            />
                          </div>
                          <div class="flex-1">
                            <TextField
                              label={language.t("provider.custom.models.modalities.value.label")}
                              hideLabel
                              placeholder={language.t("provider.custom.models.modalities.value.placeholder")}
                              value={item.value}
                              onChange={(value) => setModality(i(), modalityIndex(), "value", value)}
                              validationState={item.err.value ? "invalid" : undefined}
                              error={item.err.value}
                            />
                          </div>
                          <IconButton
                            type="button"
                            icon="trash"
                            variant="ghost"
                            class="mt-1.5"
                            onClick={() => removeModality(i(), modalityIndex())}
                            aria-label={language.t("provider.custom.models.modalities.remove")}
                          />
                        </div>
                      )}
                    </For>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      icon="plus-small"
                      onClick={() => addModality(i())}
                      class="self-start"
                    >
                      {language.t("provider.custom.models.modalities.add")}
                    </Button>
                  </div>
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex gap-2 items-start" data-row={h.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setHeader(i(), "key", v)}
                      validationState={h.err.key ? "invalid" : undefined}
                      error={h.err.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setHeader(i(), "value", v)}
                      validationState={h.err.value ? "invalid" : undefined}
                      error={h.err.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
