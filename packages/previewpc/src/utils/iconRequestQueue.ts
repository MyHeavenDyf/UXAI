/**
 * 图标 SVG 请求队列 — 合并/去重/批处理
 *
 * 解决 Step 3 高频 getIcon 调用的性能问题：
 *   - Debounce 50ms：收集同一渲染批次的所有请求
 *   - 按 (styleValue, colorId) 分组：同组 URL 合并为一次 getIcon 批量调用
 *   - 去重：相同 svgCache key (name&shape&color) 只产生一次 API 请求
 *   - 缓存快速路径：enqueue 先查 svgCache，已缓存则跳过
 *   - flush() 后统一写入 svgCache（key = name&shape&color），自增 svgCacheVersion
 */

import {
  fetchIconBatch,
  resolveSvgCacheKey,
  mapShapeToApiStyle,
  resolveApiColorId,
  svgCache,
  svgCacheVersion,
} from './fetchSvg'

interface PendingEntry {
  name: string
  shape: string
  color: string
  url: string
  styleValue: string
  colorId: string
}

export class IconRequestQueue {
  /** 按 (styleValue, colorId) 分组的待处理请求 */
  private groups: Map<string, {
    entries: PendingEntry[]
    styleValue: string
    colorId: string
  }> = new Map()

  /** 已入队的 svgCache key，防重复入队 */
  private enqueuedKeys: Set<string> = new Set()

  /** Debounce 定时器 */
  private timer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number

  constructor(debounceMs: number = 50) {
    this.debounceMs = debounceMs
  }

  /**
   * 入队一个 SVG 请求
   *
   * @returns true 表示成功入队，false 表示已缓存或已在队列中
   */
  enqueue(name: string, shape: string, color: string, url: string): boolean {
    // 1. 计算 svgCache key
    const cacheKey = resolveSvgCacheKey(name, shape, color)

    // 2. 已缓存 → 跳过
    if (svgCache.has(cacheKey)) return false

    // 3. 已入队 → 跳过（去重）
    if (this.enqueuedKeys.has(cacheKey)) return false

    // 4. 计算 API 参数
    const styleValue = mapShapeToApiStyle(shape)
    const colorId = resolveApiColorId(shape, color === 'default' ? undefined : color)

    // 5. 加入分组
    const groupKey = `${styleValue}&${colorId}`
    if (!this.groups.has(groupKey)) {
      this.groups.set(groupKey, { entries: [], styleValue, colorId })
    }
    this.groups.get(groupKey)!.entries.push({
      name, shape, color, url, styleValue, colorId,
    })
    this.enqueuedKeys.add(cacheKey)

    // 6. 重置 debounce 定时器
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)

    return true
  }

  /**
   * 刷新队列：对每个分组发起一次 fetchIconBatch，
   * 将结果写入 svgCache（key = name&shape&color），自增 svgCacheVersion
   */
  async flush() {
    this.timer = null

    // 快照当前分组并清空
    const currentGroups = new Map(this.groups)
    this.groups.clear()
    this.enqueuedKeys.clear()

    // 并行处理每个分组
    const promises: Promise<void>[] = []

    for (const [, group] of currentGroups) {
      promises.push((async () => {
        try {
          // 收集去重后的 URL 列表
          const urlSet = new Set<string>()
          for (const entry of group.entries) {
            urlSet.add(entry.url)
          }
          const urls = Array.from(urlSet)

          // 调用 API（纯调用，fetchIconBatch 不写 svgCache）
          const results = await fetchIconBatch(
            urls,
            group.styleValue,
            '16',
            group.colorId,
          )

          // 将结果写入 svgCache：用每个 entry 的 name&shape&color 作为 key
          for (const entry of group.entries) {
            const cacheKey = resolveSvgCacheKey(entry.name, entry.shape, entry.color)
            const result = results.get(entry.url)
            if (result?.data) {
              svgCache.set(cacheKey, result.data)
            }
          }
          svgCacheVersion.value++
        } catch (err) {
          console.warn('[iconRequestQueue] flush 失败:', err)
          // 失败时不写缓存，图标保持空白
        }
      })())
    }

    await Promise.allSettled(promises)
  }

  /** 强制立即刷新（可用于关键渲染场景） */
  flushNow(): void {
    if (this.timer) clearTimeout(this.timer)
    this.flush()
  }
}
