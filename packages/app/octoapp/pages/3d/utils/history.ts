/**
 * 版本回退工具 — 从历史文件读取指定版本,将场景 JSON 推送到预览。
 * (对等 pattern/utils/history.ts,但 3D 版本直接存完整 sceneJson,无需 merge)
 */
import { switchToVersion } from "./persist"

/**
 * 回退到指定版本,恢复预览。
 * @param dir        历史文件所在目录
 * @param sessionId  会话 ID
 * @param versionId  目标版本 ID
 * @param onPreview  将场景 JSON 推送到预览的回调
 * @returns 版本状态,失败返回 null
 */
export async function rollbackToVersion(
  dir: string,
  sessionId: string,
  versionId: string,
  onPreview: (data: unknown) => void,
) {
  const state = await switchToVersion(dir, sessionId, versionId)
  if (!state) return null
  if (state.sceneJson) onPreview(state.sceneJson)
  return state
}
