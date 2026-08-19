/**
 * state-path — 数据路径段/访问器操作（读写 state 嵌套值）。
 *
 * 与 access-path 区别：access-path 是 emit/stateRef 引用语义（pathToJsAccess/stateRef/cssModuleRef）；
 * 此处是数据操作：按段取值（pathToSegments/resolveBySegments）、按 accessPath 写嵌套（parseAccessors/setNested）。
 *
 * 消费方：build-trees / state-builder / scoped-enrichment 共用，避免各处 inline 重复（原 3 份 pathToSegments/resolveBySegments、2 份 setNested/parseAccessors）。
 */

/** 把 "/a/b/0/c" 或 "a/b/0/c" 归一为 segments */
export function pathToSegments(path: string): string[] {
  return path.replace(/^\//, '').split('/').filter(Boolean)
}

/** 按 segments 逐级取值；找不到 → undefined */
export function resolveBySegments(root: any, segments: string[]): any {
  let cur: any = root
  for (const seg of segments) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

/** 拆 accessPath 为访问器序列：`a.b[0][1].c` → [field a, field b, index 0, index 1, field c] */
export function parseAccessors(key: string): Array<{ kind: 'field'; field: string } | { kind: 'index'; index: number }> {
  const out: Array<{ kind: 'field'; field: string } | { kind: 'index'; index: number }> = []
  for (const part of key.split('.')) {
    const m = part.match(/^([^\[]*)((?:\[\d+\])*)$/)
    if (!m) continue
    const field = m[1]
    const indices = (m[2].match(/\[(\d+)\]/g) || []).map(s => parseInt(s.slice(1, -1), 10))
    if (field) out.push({ kind: 'field', field })
    for (const idx of indices) out.push({ kind: 'index', index: idx })
  }
  return out
}

/**
 * 按 accessPath 设嵌套值，支持数组下标：`a.b[0].c` → obj.a.b[0].c，保持原始结构。
 * accessPath 来自 pathToJsAccess：字段用 `.` 分隔、数字段用 `[n]` 紧跟字段后。
 */
export function setNested(obj: Record<string, any>, key: string, value: any): void {
  const accessors = parseAccessors(key)
  let cur: any = obj
  for (let i = 0; i < accessors.length; i++) {
    const a = accessors[i]
    const isLast = i === accessors.length - 1
    if (a.kind === 'field') {
      if (isLast) { cur[a.field] = value; return }
      const wantArray = accessors[i + 1]?.kind === 'index'
      if (cur[a.field] == null || typeof cur[a.field] !== 'object') cur[a.field] = wantArray ? [] : {}
      cur = cur[a.field]
    } else {
      // index：cur 必为数组
      if (!Array.isArray(cur)) cur = []  // 防御
      if (isLast) { cur[a.index] = value; return }
      const wantArray = accessors[i + 1]?.kind === 'index'
      if (cur[a.index] == null || typeof cur[a.index] !== 'object') cur[a.index] = wantArray ? [] : {}
      cur = cur[a.index]
    }
  }
}
