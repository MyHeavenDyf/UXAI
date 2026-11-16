const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const CUSTOM_PROVIDER_MARKER = "__octo_custom_provider"
const MODALITY_KEYS = new Set(["input", "output"])
const MODALITY_VALUES = new Set(["text", "audio", "image", "video", "pdf"])
type ModalityValue = "text" | "audio" | "image" | "video" | "pdf"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  inputLimit?: string
  outputLimit?: string
  modalities: ModalityErr[]
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModalityErr = {
  key?: string
  value?: string
}

export type ModalityRow = {
  row: string
  key: string
  value: string
  err: ModalityErr
}

export type ModelRow = {
  row: string
  id: string
  name: string
  modalities: ModalityRow[]
  imageInput?: boolean
  inputLimit?: string
  outputLimit?: string
  limit?: { context?: number; input?: number; output?: number }
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  editingProviderID?: string
}

const parseModalities = (input: string) => {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return
  }
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled && providerID !== input.editingProviderID
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    const seenModalities = new Set<string>()
    const modalities = m.modalities.map((item) => {
      const key = item.key.trim()
      const value = item.value.trim()
      const parsed = parseModalities(value)
      const keyError = !key
        ? input.t("provider.custom.error.required")
        : !MODALITY_KEYS.has(key)
          ? input.t("provider.custom.error.modalities.key")
          : seenModalities.has(key)
            ? input.t("provider.custom.error.duplicate")
            : (() => {
                seenModalities.add(key)
                return undefined
              })()
      const valueError = !value
        ? input.t("provider.custom.error.required")
        : !Array.isArray(parsed)
          ? input.t("provider.custom.error.modalities.array")
          : parsed.length === 0
            ? input.t("provider.custom.error.modalities.empty")
            : parsed.some((value) => typeof value !== "string" || !MODALITY_VALUES.has(value))
              ? input.t("provider.custom.error.modalities.value")
              : new Set(parsed).size !== parsed.length
                ? input.t("provider.custom.error.duplicate")
                : undefined
      return { key: keyError, value: valueError }
    })
    const missingModalities =
      m.modalities.length > 0 && (!seenModalities.has("input") || !seenModalities.has("output"))
        ? input.t("provider.custom.error.modalities.required")
        : undefined
    if (missingModalities) {
      modalities[0] = { ...modalities[0], key: missingModalities }
    }
    const limitError = (value: string | undefined) =>
      value?.trim() && (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)
        ? input.t("provider.custom.error.limit")
        : undefined
    return {
      id: idError,
      name: nameError,
      modalities,
      ...(limitError(m.inputLimit) ? { inputLimit: limitError(m.inputLimit) } : {}),
      ...(limitError(m.outputLimit) ? { outputLimit: limitError(m.outputLimit) } : {}),
    }
  })
  const modelsValid = models.every(
    (m) =>
      !m.id && !m.name && !m.inputLimit && !m.outputLimit && m.modalities.every((item) => !item.key && !item.value),
  )
  const modelConfig = Object.fromEntries(
    input.form.models.map((m) => {
      const modalities = Object.fromEntries(
        m.modalities.map((item) => [item.key.trim(), parseModalities(item.value.trim())]),
      ) as { input: ModalityValue[]; output: ModalityValue[] }
      if (m.imageInput !== undefined) {
        modalities.input = (modalities.input ?? ["text"]).filter((item) => item !== "image")
        if (m.imageInput) modalities.input.push("image")
        if (modalities.input.length === 0) modalities.input.push("text")
        modalities.output ??= ["text"]
      }
      const limit = Object.fromEntries(
        Object.entries({
          ...m.limit,
          ...(m.inputLimit !== undefined ? { input: m.inputLimit.trim() ? Number(m.inputLimit) : undefined } : {}),
          ...(m.outputLimit !== undefined ? { output: m.outputLimit.trim() ? Number(m.outputLimit) : undefined } : {}),
        }).filter(([, value]) => value !== undefined),
      )
      return [
        m.id.trim(),
        {
          name: m.name.trim(),
          ...(m.modalities.length > 0 || m.imageInput !== undefined ? { modalities } : {}),
          ...(Object.keys(limit).length ? { limit } : {}),
        },
      ]
    }),
  )

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          [CUSTOM_PROVIDER_MARKER]: true,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", modalities: [], err: { modalities: [] } })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
export const modalityRow = (key = "", value = ""): ModalityRow => ({
  row: nextRow(),
  key,
  value,
  err: {},
})
