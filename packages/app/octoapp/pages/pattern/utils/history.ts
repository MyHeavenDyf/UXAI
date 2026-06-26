/**
 * 版本回退工具 — 从历史文件中读取指定版本，合并 A2UI JSON 并推送到预览。
 */
import { mergeModules } from "../agents/merge"
import { detectA2UIJson } from "./a2ui-protocol"
import { switchToVersion } from "./persist"

/**
 * 回退到指定版本，恢复预览。
 * @param dir        历史文件所在目录
 * @param sessionId  会话 ID
 * @param versionId  目标版本 ID
 * @param onPreview  将合并后的 A2UI JSON 推送到预览页的回调
 * @returns 版本状态，失败返回 null
 */
export async function rollbackToVersion(
  dir: string,
  sessionId: string,
  versionId: string,
  onPreview: (data: unknown) => void,
) {
  const state = await switchToVersion(dir, sessionId, versionId)
  if (!state) return null

  if (state.lastModules.length > 0) {
    const a2ui = state.mergedA2UI
      ?? (() => {
        const shell =
          (state.lastPlanner?.layout_planner as Record<string, unknown> | undefined) ??
          state.lastPlanner
        return mergeModules(
          { rootId: (shell?.rootId as string) ?? "", elements: ((shell?.elements ?? []) as never) },
          // @ts-expect-error pre-existing type mismatch in mergeModules
          state.lastModules,
          (shell?.slots as any[]) ?? undefined,
        )
      })()
    const mergedJson = detectA2UIJson(JSON.stringify(a2ui))
    if (mergedJson) onPreview(mergedJson)
  }

  return state
}
