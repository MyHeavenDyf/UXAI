/**
 * commit-edits —— 编辑态 per-instance 材质提交落盘编排（M-1a）。
 *
 * 编辑态改子实例材质（C 层即时生效、不落盘）→ 累积进 editDelta → 用户点「提交」
 * → 本编排：读当前 codeDir 全量文件 + mergedSceneConfig → 反查每个 __id 所属 type
 * → 对受影响 handler 源码调 patchHandlerMaterial 合进 SUB_OVERRIDES → 重组全量 codeFiles
 * → 调 onCodeVersionReady（appendSceneVersion + switchVersion + wsNonce++ → iframe 重载，
 *   override Map 项随重生成生效）。导出即代码终态，无烘焙。
 *
 * 边界：handler 不合契约（无 SUB_OVERRIDES 骨架 / __id 非语义命名 / codeDir 缺该 type）
 * → 该项跳过并回报 reason，不阻断其余项。全失败 → 回报 error，提示重新生成。
 */
import { loadCurrentSceneState, readCodeDirFiles } from "../utils/version-history"
import {
  patchHandlerOverride,
  resolveTypeId,
  handlerFilePathForType,
  isFallbackPartId,
  patchHandlerMaterialColor,
} from "../utils/patch-handler"
import type { CodeFile } from "../utils/parse-code-files"
import type { EditDeltaEntry } from "../utils/scene-config"

export type CommitEditsInput = {
  /** 场景历史目录（sceneHistoryDir()） */
  sceneDir: string
  /** 会话 ID */
  sid: string
  /** __id → 材质/transform 改动（编辑态累加器，rotation 存弧度） */
  delta: Map<string, EditDeltaEntry>
  /** 物化入口（父 onCodeVersionReady：appendSceneVersion + switchVersion + wsNonce++） */
  onCodeVersionReady: (
    files: CodeFile[],
    summary: string,
    sceneData: Record<string, unknown> | null,
  ) => Promise<void>
}

export type CommitEditsResult = {
  ok: boolean
  /** 成功 patch 进 handler 的项数 */
  committedCount: number
  /** 无法落盘的项 + 原因 */
  skipped: { __id: string; reason: string }[]
  error?: string
}

export async function commitEdits(input: CommitEditsInput): Promise<CommitEditsResult> {
  const { sceneDir, sid, delta, onCodeVersionReady } = input
  const skipped: { __id: string; reason: string }[] = []

  if (delta.size === 0) return { ok: true, committedCount: 0, skipped }

  // 1. 取当前版本 codeDir + mergedSceneConfig
  const state = await loadCurrentSceneState(sceneDir, sid)
  const codeDir = state?.codeDir
  const merged = state?.mergedSceneConfig ?? null
  if (!codeDir) {
    return {
      ok: false,
      committedCount: 0,
      skipped,
      error: "当前版本无代码归档（旧版本或生成时未落盘 codeDir），需重新生成场景后再编辑",
    }
  }
  if (!merged) {
    return { ok: false, committedCount: 0, skipped, error: "无 mergedSceneConfig，无法反查 __id 所属 type" }
  }

  // 2. 读 codeDir 全量文件
  const files = await readCodeDirFiles(codeDir)
  if (!files || files.length === 0) {
    return { ok: false, committedCount: 0, skipped, error: `读 codeDir 失败或为空：${codeDir}` }
  }

  // 3. 按 type 分组 delta（反查 __id → type）
  const byType = new Map<string, { __id: string; entry: EditDeltaEntry }[]>()
  for (const [__id, entry] of delta) {
    const type = resolveTypeId(merged, __id)
    if (!type) {
      skipped.push({
        __id,
        reason: "无法反推所属 type（__id 非语义命名或引擎兜底 part-N，需 handler 重生成带语义 __id）",
      })
      continue
    }
    const arr = byType.get(type) ?? []
    arr.push({ __id, entry })
    byType.set(type, arr)
  }

  // 4. 对每个受影响 type 的 handler 源码 patch
  for (const [type, entries] of byType) {
    // 该 type 的顶层节点行（__id === node.id = group 根整体；__id startsWith node.id- = 子实例）。
    // P0.1-4：group 根 transform 走 live-data params（set_type_transform 语义），不走 SUB_OVERRIDES——
    // handler 只对子实例 cid 调 applyOverride（forklift.ts:137 spawnForklift 内），从不对 group 根调 →
    // SUB_OVERRIDES[group 根]=死项（实证「整体编辑叉车位置未生效，单个生效」）。group 根 transform 本就
    // 来自 live-data params（opts.position/fromArray），改 params → handler 重读生效（同 set_type_transform 已验证）。
    const rawRows = merged[type]
    const typeRows: Array<{ id?: string; params?: Record<string, unknown> }> = Array.isArray(rawRows)
      ? rawRows
      : []
    const handlerPath = handlerFilePathForType(type)
    const target = files.find(
      (f) => f.path === handlerPath || f.path.replace(/\\/g, "/").endsWith(handlerPath),
    )
    if (!target) {
      for (const { __id } of entries) {
        skipped.push({ __id, reason: `codeDir 未找到 ${type} handler 文件（${handlerPath}），需重新生成` })
      }
      continue
    }
    let src = target.content
    for (const { __id, entry } of entries) {
      try {
        // P0.1-4：group 根（__id === node.id，整体选中）transform → live-data params（绕过 SUB_OVERRIDES 死项）。
        // 该项 continue 不进 skipped，committedCount=delta.size-skipped.length 自然计为成功。
        if (entry.transform) {
          const rootNode = typeRows.find((n) => n.id === __id)
          if (rootNode) {
            if (!rootNode.params) rootNode.params = {}
            if (entry.transform.position) rootNode.params.position = entry.transform.position
            if (entry.transform.rotation) rootNode.params.rotation = entry.transform.rotation
            if (entry.transform.scale) rootNode.params.scale = entry.transform.scale
            continue // merged 已就地改，onCodeVersionReady(files, summary, merged) 落盘 + reload handler 读新 params
          }
        }
        // 兜底 part-N __id（组件型 Group 内部子 mesh，如 Wall/GLB）：SUB_OVERRIDES+applyOverride 对黑盒
        // Group 走不通（key 错位 + Group 无 material + part __id 由 manager 在 create 后盖、applyOverride 在
        // create 内调时序错位）→ 材质改色走 edit_code 改 handler 的 color 字面量（重建时组件用新色，确定性持久）。
        if (isFallbackPartId(__id) && entry.material?.color) {
          const newHex = "0x" + entry.material.color.replace(/^#/, "")
          const r = patchHandlerMaterialColor(src, newHex)
          if (r.failed) {
            skipped.push({ __id, reason: r.failed.reason })
          } else {
            src = r.source
          }
        } else {
          src = patchHandlerOverride(src, __id, entry)
        }
      } catch (e) {
        skipped.push({ __id, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    target.content = src
  }

  const committedCount = delta.size - skipped.length
  if (committedCount <= 0) {
    return {
      ok: false,
      committedCount: 0,
      skipped,
      error: "无可落盘改动（全部 __id 反查失败或 handler 不合契约，详见 skipped）",
    }
  }

  // 5. 重组全量 codeFiles → 物化（appendSceneVersion + switchVersion + wsNonce++）
  const summary =
    skipped.length > 0
      ? `编辑 ${committedCount} 项（${skipped.length} 项跳过）`
      : `编辑 ${committedCount} 项`
  await onCodeVersionReady(files, summary, merged)

  return { ok: true, committedCount, skipped }
}
