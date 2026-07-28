/**
 * ProtoTheme — Proto Agent Prompt 的主题化替换系统
 *
 * ## 整体架构
 *
 * proto agent 的 prompt 模板（如 proto_triage.md）中包含 `{VAR_NAME}` 形式的占位符，
 * 需要在运行时替换为实际内容。替换有两个层级：
 *
 * 1. **静态替换（staticData）**：在模块加载时完成，用 `index.ts` 中的 `staticData` 替换
 *    通用占位符（如 `{COMPONENTS_CATALOG}`、`{A2UI_JSON_PROTOCOL}` 等）。
 *    替换后的结果导出为 `PROMPT_PROTO_TRIAGE` 等常量，作为 agent 定义中的默认 prompt。
 *    新增的 `ATTITUDE` 和 `POEM` 也已加入 staticData，因此静态替换后它们也会被替换。
 *
 * 2. **动态替换（theme overrides）**：在运行时，根据 session 选用的"设计主题"，从
 *    `~/.config/octo/design/{theme}/` 目录加载 override 文件（如 `POEM.md`、
 *    `COMPONENTS_CATALOG.md`），覆盖 staticData 中的默认值。override 优先级高于
 *    staticData，使得同一个 agent 在不同主题下可以使用不同的设计知识。
 *
 * ## 主题的来源
 *
 * 前端 octoapp 在用户首次发送消息时，通过 `saveTheme()` 将选中的设计系统主题名
 * 写入项目目录下的 `.octo/design/history/{rootSessionID}/theme.json`，
 * 格式为 `{ "theme": "ICT3.1", "createdAt": ... }`。
 *
 * ## 子 session 的处理
 *
 * proto agent（如 proto_triage）通过 `runChildSession` 创建子 session 运行。
 * 子 session 的 ID 目录下没有 theme.json，只有根 session 有。
 * 因此当当前 session 找不到 theme.json 时，会通过数据库查找 `session.parent_id`，
 * 向上追溯到父 session 的 theme.json。
 *
 * ## 文件读取方式
 *
 * 使用 `fs.readFileSync` 而非 `Bun.file().json()`，因为后者在 Windows 中文路径
 * （如 `D:\桌面\pipeline\...`）下会读取失败。readFileSync 在任何编码环境下都能正常工作。
 *
 * ## fallback 逻辑
 *
 * `resolvePromptForSession` 在找不到任何 theme 时，返回 `STATIC_PROMPTS[agentName]`
 * （即静态替换后的默认 prompt），确保 proto agent 在任何情况下都能获得完整、
 * 无残留占位符的 prompt。llm.ts 只需直接使用返回值，无需额外 fallback 逻辑。
 */

import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { formatPrompt, RAW_TEMPLATES, staticData, PROMPT_PROTO_INTENT, PROMPT_PROTO_INTENT_AUDIT, PROMPT_PROTO_MODULE_CREATE, PROMPT_PROTO_MODULE_MODIFY, PROMPT_PROTO_PLANNER_CREATE, PROMPT_PROTO_PLANNER_MODIFY, PROMPT_PROTO_TRIAGE, PROMPT_PROTO_PATTERN_PAGE, PROMPT_PROTO_PATTERN_BLOCK, PROMPT_PROTO_INTENT_CONFIRM, PROMPT_PROTO_WFRAMES, PROMPT_PROTO_MODIFY, PROMPT_PROTO_REPLANNER } from "./index"
import { InstanceState } from "@/effect/instance-state"
import { Database, eq } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import path from "path"
import { homedir } from "os"
import { readdirSync, readFileSync } from "fs"

const log = Log.create({ service: "proto.theme" })

/** 静态替换后的默认 prompt，作为无 theme 时的 fallback。
 *  导出供 proto-theme 插件做反查（system[0] 是否是某 proto agent 的静态 prompt）。 */
export const STATIC_PROMPTS: Record<string, string> = {
  proto_intent: PROMPT_PROTO_INTENT,
  proto_intent_audit: PROMPT_PROTO_INTENT_AUDIT,
  proto_module_create: PROMPT_PROTO_MODULE_CREATE,
  proto_module_modify: PROMPT_PROTO_MODULE_MODIFY,
  proto_planner_create: PROMPT_PROTO_PLANNER_CREATE,
  proto_planner_modify: PROMPT_PROTO_PLANNER_MODIFY,
  proto_triage: PROMPT_PROTO_TRIAGE,
  proto_pattern_page: PROMPT_PROTO_PATTERN_PAGE,
  proto_pattern_block: PROMPT_PROTO_PATTERN_BLOCK,
  proto_intent_confirm: PROMPT_PROTO_INTENT_CONFIRM,
  proto_wireframes: PROMPT_PROTO_WFRAMES,
  proto_modify: PROMPT_PROTO_MODIFY,
  proto_replanner: PROMPT_PROTO_REPLANNER,
}

/** 返回 override 文件的存放目录：~/.config/octo/design/{theme}/ */
function designDir(theme: string) {
  return path.join(homedir(), ".config", "octo", "design", theme)
}

/** override 文件缓存，避免重复读取磁盘 */
const filesCache = new Map<string, Record<string, string> | undefined>()

/**
 * 从 ~/.config/octo/design/{theme}/ 加载所有 .md override 文件。
 * 文件名去掉 .md 后缀即为占位符变量名（如 `POEM.md` → key `"POEM"`），
 * 文件内容为替换值。这些值会覆盖 staticData 中的同名默认值。
 */
async function loadThemeOverrides(theme: string): Promise<Record<string, string> | undefined> {
  if (filesCache.has(theme)) return filesCache.get(theme)

  const dir = designDir(theme)
  let entries: string[]
  try { entries = readdirSync(dir) } catch {
    log.info("no design dir for theme", { theme, dir })
    filesCache.set(theme, undefined)
    return undefined
  }

  const overrides: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue
    const varName = path.basename(entry, ".md")
    const filePath = path.join(dir, entry)
    try {
      const content = readFileSync(filePath, "utf-8")
      log.info("loaded theme override", { theme, file: entry, varName })
      overrides[varName] = content
    } catch {
      log.info("failed to read theme file", { theme, file: entry })
    }
  }

  if (Object.keys(overrides).length === 0) {
    filesCache.set(theme, undefined)
    return undefined
  }

  filesCache.set(theme, overrides)
  return overrides
}

/**
 * 从项目目录的 .octo/design/history/{sessionID}/theme.json 中读取主题名。
 * 使用 readFileSync 而非 Bun.file，因为 Bun.file 在 Windows 中文路径下会读取失败。
 * 返回 undefined 表示该 session 没有主题配置。
 */
function readThemeJsonSync(projectDir: string, sessionID: string): string | undefined {
  const filePath = path.join(projectDir, ".octo", "design", "history", sessionID, "theme.json")
  try {
    const raw = readFileSync(filePath, "utf-8")
    const data = JSON.parse(raw) as { theme?: string } | null
    return typeof data?.theme === "string" ? data.theme : undefined
  } catch {
    return undefined
  }
}

/**
 * 通过数据库查找 session 的 parent_id。
 * proto agent 以子 session 运行，theme.json 保存在根 session 目录下，
 * 因此子 session 找不到 theme.json 时需要向上追溯到父 session。
 */
function findParentSessionID(sessionID: string): string | undefined {
  const row = Database.use((db) =>
    db.select({ parent_id: SessionTable.parent_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID as any))
      .get()
  )
  return row?.parent_id ?? undefined
}

/**
 * 为指定 session 解析 proto agent 的最终 prompt。
 *
 * 流程：
 * 1. 检查 agentName 是否有对应的 RAW_TEMPLATE，没有则返回 undefined（不是 proto agent）
 * 2. 从当前 session 的 theme.json 读取主题名
 * 3. 当前 session 没有 theme.json → 通过数据库查 parent_id，从父 session 读取
 * 4. 找不到任何 theme → 返回 STATIC_PROMPTS[agentName]（静态替换后的默认 prompt）
 * 5. 找到 theme → 加载 override 文件，用 formatPrompt(raw, overrides) 替换占位符
 *    （override 优先级高于 staticData）
 *
 * @param agentName - proto agent 名称，如 "proto_triage"
 * @param sessionID - 当前 session ID（可能是子 session）
 * @returns 最终 prompt 字符串，或 undefined（非 proto agent）
 */
export function resolvePromptForSession(
  agentName: string,
  sessionID: string,
): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const raw = RAW_TEMPLATES[agentName]
    if (!raw) return undefined

    const ctx = yield* InstanceState.context
    let theme = readThemeJsonSync(ctx.directory, sessionID)

    if (!theme) {
      const parentID = findParentSessionID(sessionID)
      if (parentID) theme = readThemeJsonSync(ctx.directory, parentID)
    }

    if (!theme) return STATIC_PROMPTS[agentName]

    log.info("theme resolved", { sessionID, theme })
    const overrides = yield* Effect.promise(() => loadThemeOverrides(theme))
    return formatPrompt(raw, overrides ?? {})
  })
}

/**
 * `resolvePromptForSession` 的纯 async 版本，供插件 hook（非 Effect 上下文）调用。
 *
 * 与 Effect 版的区别仅在于：directory 由调用方显式传入（取自 PluginInput.directory），
 * 不再走 `InstanceState.context`。其余逻辑（theme.json 读取、parent 回溯、override 加载、
 * formatPrompt 替换、fallback 到 STATIC_PROMPTS）完全一致。
 *
 * `Database.use` 是同步函数（LocalContext 兜底到全局 Client），在纯 async 上下文里也能工作；
 * `loadThemeOverrides` 内部全用 readFileSync/readdirSync，async 仅是 Promise 包装。
 */
export async function resolvePromptForSessionAsync(
  agentName: string,
  sessionID: string,
  directory: string,
): Promise<string | undefined> {
  const raw = RAW_TEMPLATES[agentName]
  if (!raw) return undefined

  let theme = readThemeJsonSync(directory, sessionID)
  if (!theme) {
    const parentID = findParentSessionID(sessionID)
    if (parentID) theme = readThemeJsonSync(directory, parentID)
  }

  if (!theme) return STATIC_PROMPTS[agentName]

  log.info("theme resolved", { sessionID, theme })
  const overrides = await loadThemeOverrides(theme)
  return formatPrompt(raw, overrides ?? {})
}

/** 判断 agent 是否有对应的 RAW_TEMPLATE（即是否是 proto agent） */
export function hasTemplate(agentName: string): boolean {
  return RAW_TEMPLATES[agentName] !== undefined
}

export * as ProtoTheme from "./theme"
