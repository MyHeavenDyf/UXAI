/**
 * js-serializer — 智能的 JS 对象/数组序列化
 *
 * 与 JSON.stringify 的差异：
 *   1. 对象 key 只在必要时加引号（含特殊字符 / 首字符为数字 / JS 保留字）
 *   2. 嵌套对象/数组按缩进美化，不再拍成单行
 *
 * 用于：
 *   - state.ts 的 initialState 生成
 *   - file-assembler 的 const 值序列化（纯 JS 数据部分）
 */

// JS 保留字（变量名不能用）
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static',
  'enum', 'await', 'implements', 'interface', 'package', 'private', 'protected',
  'public', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity',
])

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

/** 判断 key 是否需要加引号 */
export function needsQuote(key: string): boolean {
  if (!IDENT_RE.test(key)) return true
  if (RESERVED_WORDS.has(key)) return true
  return false
}

/** 序列化 key：必要时加引号 */
export function emitKey(key: string): string {
  return needsQuote(key) ? JSON.stringify(key) : key
}

/** 序列化字符串值（含转义） */
function emitString(s: string): string {
  return JSON.stringify(s)
}

/** 缩进辅助 */
function pad(n: number): string {
  return ' '.repeat(n)
}

/**
 * 序列化纯 JS 数据（不含 PropValue 特殊类型）。
 *
 * @param value   要序列化的值
 * @param indent  当前缩进空格数（顶层传 0）
 * @returns       带换行和缩进的 JS 源代码字符串
 */
export function serializePlainJs(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return emitString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (typeof value === 'function') {
    console.warn('  [warn] js-serializer: 含函数，回退 null')
    return 'null'
  }

  const childIndent = indent + 2

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map(v => pad(childIndent) + serializePlainJs(v, childIndent))
    return '[\n' + items.join(',\n') + '\n' + pad(indent) + ']'
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, any>
    const keys = Object.keys(obj).filter(k => !k.startsWith('__'))
    if (keys.length === 0) return '{}'
    const entries = keys.map(k => `${pad(childIndent)}${emitKey(k)}: ${serializePlainJs(obj[k], childIndent)}`)
    return '{\n' + entries.join(',\n') + '\n' + pad(indent) + '}'
  }

  return 'null'
}
