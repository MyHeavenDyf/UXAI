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
