import { createSignal } from "solid-js"

/**
 * 创建一个按 session ID 隔离的状态 Map
 *
 * 用法：
 *   const [items, setItems] = createSessionMap<T>()
 *   // 写入
 *   sm.set(setItems, sid, value)
 *   // 读取
 *   sm.get(items, sid, fallback)
 *   // 函数式更新
 *   sm.update(setItems, sid, prev => [...prev, item], [])
 *   // 清除
 *   sm.clear(setItems, sid)
 */
export function createSessionMap<T>(initial: Record<string, T> = {}) {
  return createSignal<Record<string, T>>(initial)
}

/**
 * 读取指定 session 的值，不存在时返回 fallback
 */
export function get<T>(signal: () => Record<string, T>, sid: string, fallback: T): T {
  return signal()[sid] ?? fallback
}

/**
 * 写入指定 session 的值
 */
export function set<T>(setter: (fn: (prev: Record<string, T>) => Record<string, T>) => void, sid: string, value: T): void {
  setter((prev) => ({ ...prev, [sid]: value }))
}

/**
 * 函数式更新指定 session 的值
 */
export function update<T>(setter: (fn: (prev: Record<string, T>) => Record<string, T>) => void, sid: string, updater: (prev: T) => T, fallback: T): void {
  setter((prev) => ({ ...prev, [sid]: updater(prev[sid] ?? fallback) }))
}

/**
 * 清除指定 session 的值
 */
export function clear<T>(setter: (fn: (prev: Record<string, T>) => Record<string, T>) => void, sid: string): void {
  setter((prev) => {
    if (!(sid in prev)) return prev
    const next = { ...prev }
    delete next[sid]
    return next
  })
}
