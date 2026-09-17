import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, uniqueBy, values } from "remeda"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useProviders } from "@/hooks/use-providers"
import { useGlobalSync } from "@/context/global-sync"
import {
  fetchModelsApi,
  hasApiModels,
  hasModelsApiToken,
  modelsApiListForProviders,
  modelsApiProviders,
  modelsApiUrl,
  modelsLocalListForProviders,
  refreshRemoteModels,
  registerModelsApiRefresh,
} from "@/network/models-api"
import { Persist, persisted } from "@/utils/persist"

export type ModelKey = { providerID: string; modelID: string }

type Visibility = "show" | "hide"
type User = ModelKey & { visibility: Visibility; favorite?: boolean }
type Store = {
  user: User[]
  recent: ModelKey[]
  variant?: Record<string, string | undefined>
}

const RECENT_LIMIT = 5

function modelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

export const { use: useModels, provider: ModelsProvider } = createSimpleContext({
  name: "Models",
  init: () => {
    const providers = useProviders()
    const globalSync = useGlobalSync()
    const mergeApiModels = (models: Awaited<ReturnType<typeof fetchModelsApi>>) => {
      const remoteProviders = modelsApiProviders(models)
      globalSync.replaceProviders(remoteProviders)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Model catalog updated",
        description: `${remoteProviders.length} providers, ${remoteProviders.reduce(
          (total, provider) => total + Object.keys(provider.models).length,
          0,
        )} models`,
      })
    }
    const [apiModels, setApiModels] = createSignal<Awaited<ReturnType<typeof fetchModelsApi>>>()
    const [refreshing, setRefreshing] = createSignal(false)
    const [refreshError, setRefreshError] = createSignal<unknown>()

    const refreshApiModels = async () => {
      if (!modelsApiUrl()) return
      if (refreshing()) return
      setRefreshing(true)
      setRefreshError(undefined)
      try {
        await refreshRemoteModels()
      } catch (error) {
        setRefreshError(error)
      } finally {
        setRefreshing(false)
      }
    }

    onMount(() => {
      if (!hasModelsApiToken()) return
      void refreshApiModels()
    })

    onCleanup(
      registerModelsApiRefresh(async (models) => {
        mergeApiModels(models)
        setApiModels(models)
      }),
    )

    const [store, setStore, _, ready] = persisted(
      Persist.global("model", ["model.v1"]),
      createStore<Store>({
        user: [],
        recent: [],
        variant: {},
      }),
    )

    const available = createMemo(() => {
      const api = apiModels()
      if (!hasApiModels(api)) return modelsLocalListForProviders(providers.connected())
      const remoteProviderIDs = new Set(
        Object.entries(api).map(([key, provider]) =>
          typeof provider?.id === "string" && provider.id ? provider.id : key,
        ),
      )
      const connected = providers.connected()
      return uniqueBy(
        [
          ...modelsApiListForProviders(api, connected),
          ...modelsLocalListForProviders(
            connected.filter((provider) => provider.source === "config" && !remoteProviderIDs.has(provider.id)),
          ),
        ],
        (model) => modelKey({ providerID: model.provider.id, modelID: model.id }),
      )
    })

    const release = createMemo(
      () =>
        new Map(
          available().map((model) => {
            const parsed = DateTime.fromISO(model.release_date)
            return [modelKey({ providerID: model.provider.id, modelID: model.id }), parsed] as const
          }),
        ),
    )

    const latest = createMemo(() =>
      pipe(
        available(),
        filter(
          (x) =>
            Math.abs(
              (release().get(modelKey({ providerID: x.provider.id, modelID: x.id })) ?? DateTime.invalid("invalid"))
                .diffNow()
                .as("months"),
            ) < 6,
        ),
        groupBy((x) => x.provider.id),
        mapValues((models) =>
          pipe(
            models,
            groupBy((x) => x.family),
            values(),
            (groups) =>
              groups.flatMap((g) => {
                const first = firstBy(g, [(x) => x.release_date, "desc"])
                return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
              }),
          ),
        ),
        values(),
        flat(),
      ),
    )

    const latestSet = createMemo(() => new Set(latest().map((x) => modelKey(x))))

    const visibility = createMemo(() => {
      const map = new Map<string, Visibility>()
      for (const item of store.user) map.set(`${item.providerID}:${item.modelID}`, item.visibility)
      return map
    })

    const list = createMemo(() =>
      available().map((m) => ({
        ...m,
        name: m.name.replace("(latest)", "").trim(),
        latest: m.name.includes("(latest)"),
      })),
    )

    const find = (key: ModelKey) => list().find((m) => m.id === key.modelID && m.provider.id === key.providerID)

    function update(model: ModelKey, state: Visibility) {
      const index = store.user.findIndex((x) => x.modelID === model.modelID && x.providerID === model.providerID)
      if (index >= 0) {
        setStore("user", index, (current) => ({ ...current, visibility: state }))
        return
      }
      setStore("user", store.user.length, { ...model, visibility: state })
    }

    const visible = (model: ModelKey) => {
      const key = modelKey(model)
      const state = visibility().get(key)
      if (state === "hide") return false
      if (state === "show") return true
      if (find(model)?.isExternal) return false
      if (latestSet().has(key)) return true
      const date = release().get(key)
      if (!date?.isValid) return true
      return false
    }

    const setVisibility = (model: ModelKey, state: boolean) => {
      update(model, state ? "show" : "hide")
    }

    const push = (model: ModelKey) => {
      const uniq = uniqueBy([model, ...store.recent], (x) => `${x.providerID}:${x.modelID}`)
      if (uniq.length > RECENT_LIMIT) uniq.pop()
      setStore("recent", uniq)
    }

    const variantKey = (model: ModelKey) => `${model.providerID}/${model.modelID}`
    const getVariant = (model: ModelKey) => store.variant?.[variantKey(model)]

    const setVariant = (model: ModelKey, value: string | undefined) => {
      const key = variantKey(model)
      if (!store.variant) {
        setStore("variant", { [key]: value })
        return
      }
      setStore("variant", key, value)
    }

    return {
      ready,
      remote: {
        api: apiModels,
        loading: refreshing,
        error: refreshError,
        refresh: refreshApiModels,
      },
      list,
      find,
      visible,
      setVisibility,
      recent: {
        list: createMemo(() => store.recent),
        push,
      },
      variant: {
        get: getVariant,
        set: setVariant,
      },
    }
  },
})
