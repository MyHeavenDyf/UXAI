/**
 * chart-defaults merge — 默认 option 深合并 + 运行时函数序列化
 *
 * 职责：
 *   1. deepMerge(默认, 用户) — 递归合并，用户属性始终优先
 *   2. functionify(对象)    — 将对象树中的 Function 转为 { type: 'rawExpr', value: fnStr }
 *   3. cleanUnderscoreKeys   — 清洗 __ 开头的临时字段
 *
 * 函数序列化说明：
 *   默认 option 中包含运行时函数（如 formatter），
 *   在 transform 阶段它们是 JS Function 对象，
 *   需要转为 RawExprValue 才能被 jsx-emitter 正确 emit。
 *
 *   闭包引用处理：
 *   defOption.xxx 形式的引用会被转换为实际值的嵌入。
 *   字面量 → JSON 内联；非字面量（BindingValue）→ 保持变量引用。
 */

import type { PropValue } from '../../src/core/valueTypes'

// ─── 类型 ───

export interface ChartDefaultFn {
  (iChartOpt: Record<string, any>): Record<string, any>
}

// ─── 深合并 ───

/**
 * 将 task 的所有属性合并到 target（task 属性优先）。
 * 与桌面 merge.js 行为一致：用户属性优先，默认填充缺失。
 */
export function deepMerge(
  target: Record<string, any>,
  task: Record<string, any>,
): Record<string, any> {
  if (target === undefined || target === null) return task ?? target
  if (task === undefined || task === null) return target

  for (const key of Object.keys(task)) {
    const tv = task[key]
    const tgt = target[key]

    // target 无此字段 → 取 task 值
    if (tgt === undefined || tgt === null) {
      target[key] = tv
      continue
    }

    // 双方都是普通对象（非数组、非 BindingValue 等）→ 递归
    if (isPlainObject(tgt) && isPlainObject(tv)) {
      target[key] = deepMerge({ ...tgt }, tv)
      continue
    }

    // task 属性优先
    target[key] = tv
  }

  return target
}

// ─── functionify — 运行时函数 → RawExprValue ───

/**
 * 递归遍历对象树，将 Function 类型的值转为 RawExprValue。
 * 同时处理闭包引用：defOption.xxx → 实际值的嵌入。
 */
export function functionify(obj: any, mergedRef?: Record<string, any>): void {
  if (!obj || typeof obj !== 'object') return

  const ref = mergedRef ?? obj

  for (const key of Object.keys(obj)) {
    const val = obj[key]

    if (typeof val === 'function') {
      let fnStr = val.toString()

      // 处理 defOption.xxx 闭包引用 → 嵌入实际值
      fnStr = resolveDefOptionRefs(fnStr, ref)

      obj[key] = { type: 'rawExpr' as const, value: fnStr }
    } else if (isPlainObject(val) && !hasSpecialType(val)) {
      functionify(val, ref)
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const item = val[i]
        if (isPlainObject(item) && !hasSpecialType(item)) {
          functionify(item, ref)
        } else if (typeof item === 'function') {
          let fnStr = item.toString()
          fnStr = resolveDefOptionRefs(fnStr, ref)
          val[i] = { type: 'rawExpr' as const, value: fnStr }
        }
      }
    }
  }
}

/**
 * 替换函数字符串中的 defOption.xxx 引用。
 * 如果 xxx 在当前 mergedRef 中可序列化，则内联；
 * 否则保留原样（运行时需有对应变量在作用域内）。
 */
function resolveDefOptionRefs(fnStr: string, mergedRef: Record<string, any>): string {
  return fnStr.replace(/defOption\.(\w+)/g, (_match, propName: string) => {
    if (propName in mergedRef) {
      const propVal = mergedRef[propName]
      // 可 JSON 序列化的值 → 内联
      if (isJsonSafe(propVal)) {
        return JSON.stringify(propVal)
      }
      // BindingValue → 用 accessPath 变量名
      if (propVal && typeof propVal === 'object' && propVal.type === 'binding') {
        return propVal.accessPath ?? propVal.path ?? propName
      }
    }
    // 无法处理 → 保持原引用（编译期警告）
    console.warn(`[chartDefaults] 无法解析闭包引用: defOption.${propName}，已保留`)
    return `/* defOption.${propName} */`
  })
}

function isJsonSafe(val: any): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return true
  if (Array.isArray(val)) return val.every(isJsonSafe)
  if (isPlainObject(val)) {
    // 不含特殊类型（BindingValue 等）
    return !Object.values(val).some(v => v && typeof v === 'object' && (v as any).type)
  }
  return false
}

/** 是否是纯对象（非数组、非 null、无特殊 type 字段） */
function isPlainObject(val: any): boolean {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && !(val as any).type
}

/** 是否存在管线特殊类型字段（binding / computed 等） */
function hasSpecialType(val: any): boolean {
  return val && typeof val === 'object' && typeof val.type === 'string'
}

// ─── 清洗 __ 前缀字段 ───

/**
 * 递归删除 __ 开头的内部字段（如 __underscore 临时属性）。
 */
export function cleanUnderscoreKeys(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(cleanUnderscoreKeys)

  const cleaned: Record<string, any> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('__')) continue
    cleaned[key] = cleanUnderscoreKeys(val)
  }
  return cleaned
}
