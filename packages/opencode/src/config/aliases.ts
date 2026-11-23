export * as ConfigAliases from "./aliases"

import { Schema } from "effect"
import { applyEdits, modify, parseTree } from "jsonc-parser"
import { mergeDeep } from "remeda"
import { isRecord } from "@/util/record"
import { ConfigParse } from "./parse"
import { ConfigPlugin } from "./plugin"
import { ConfigProvider } from "./provider"

const fields = Schema.Struct({
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)),
  providers: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)),
  plugin: Schema.optional(Schema.Array(ConfigPlugin.Spec)),
  plugins: Schema.optional(Schema.Array(ConfigPlugin.Spec)),
})

export function normalize(data: unknown, source: string) {
  if (!isRecord(data) || (!("providers" in data) && !("plugins" in data))) return data
  // Validate both spellings before merging so an invalid value cannot be hidden by its alias.
  const parsed = ConfigParse.effectSchema(
    fields,
    Object.fromEntries(Object.entries(data).filter(([key]) => key in fields.fields)),
    source,
  )
  const { providers: _, plugins: __, ...next } = data
  return {
    ...next,
    ...("providers" in data ? { provider: mergeDeep(parsed.providers ?? {}, parsed.provider ?? {}) } : {}),
    ...("plugins" in data
      ? {
          plugin: ConfigPlugin.deduplicatePluginOrigins(
            [...(parsed.plugins ?? []), ...(parsed.plugin ?? [])].map((spec) => ({ spec, source, scope: "global" })),
          ).map((item) => item.spec),
        }
      : {}),
  }
}

// Only migrate aliases when saving. Keep unrelated JSONC comments and formatting intact.
export function canonicalize(text: string, source: string) {
  const data = ConfigParse.jsonc(text, source)
  const normalized = normalize(data, source)
  if (!isRecord(data) || !isRecord(normalized)) return text
  return [
    ["providers", "provider"],
    ["plugins", "plugin"],
  ].reduce((result, [alias, key]) => {
    if (!(alias in data)) return result
    if (!(key in data)) {
      const node = parseTree(result)?.children?.find((item) => item.children?.[0]?.value === alias)?.children?.[0]
      if (!node) return result
      const renamed = result.slice(0, node.offset) + JSON.stringify(key) + result.slice(node.offset + node.length)
      return applyEdits(
        renamed,
        modify(renamed, [key], normalized[key], {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      )
    }
    const updated = applyEdits(
      result,
      modify(result, [key], normalized[key], {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    )
    return applyEdits(updated, modify(updated, [alias], undefined, {}))
  }, text)
}
