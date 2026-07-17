/**
 * 分区物体生成的容错包装。
 *
 * 背景：LLM 偶发返回空串 / 坏 JSON（实测案例：操场 4 分区并行，其中 1 个返回 length=0，
 * extractJson 返回 null，scene_3d_module_create 抛 "did not return valid JSON"）。
 * 此前 create_modules_json / modify_scene_ai 用 Promise.all，单个分区失败会让整次生成崩掉。
 *
 * 策略：重试一次（瞬态失败常见，重试大概率成功）；仍失败则返回 null（调用方按"跳过该分区"兜底），
 * 让用户拿到部分场景而非全盘失败，可再走 modify 补齐。
 */
export async function withModuleRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < 2) {
        console.warn(`[3d] ${label} 生成失败（${msg}），重试一次...`)
        continue
      }
      console.error(`[3d] ${label} 重试仍失败（${msg}），跳过该分区`)
      return null
    }
  }
  return null
}
