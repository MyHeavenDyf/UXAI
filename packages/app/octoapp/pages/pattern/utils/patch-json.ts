export type PatchOp = DataAddOp | DataReplaceOp | DataRemoveOp | ElementAddOp | ElementRemoveOp | PropsReplaceOp | ChildrenReplaceOp | IdRenameOp

type PatchState = Record<string, unknown>

interface PatchElement {
  id: string
  component: string
  props?: Record<string, unknown>
  children?: string[] | { path: string; componentId?: string }
}

export interface PatchSource {
  rootId: string
  elements: PatchElement[]
  state?: PatchState
}

type PathSegment = string | number

type DataAddOp = { op: "data_add"; path: string; value: unknown }
type DataReplaceOp = { op: "data_replace"; path: string; value: unknown }
type DataRemoveOp = { op: "data_remove"; path: string }
type ElementAddOp = { op: "element_add"; value: PatchElement }
type ElementRemoveOp = { op: "element_remove"; element_id: string; remove_subtree?: boolean }
type PropsReplaceOp = { op: "props_replace"; element_id: string; value: Record<string, unknown>; component?: string }
type ChildrenReplaceOp = { op: "children_replace"; element_id: string; value: string[] | { path: string; componentId?: string } }
type IdRenameOp = { op: "id_rename"; old_id: string; new_id: string }

const OP_ORDER: Record<string, number> = {
  id_rename: 1,
  data_add: 2,
  data_replace: 2,
  data_remove: 2,
  element_add: 3,
  children_replace: 4,
  element_remove: 5,
  props_replace: 6,
}

function parsePath(path: string): PathSegment[] {
  return path.split("/").map((p) => (p !== "" && /^\d+$/.test(p) ? Number(p) : p))
}

function navigate(data: unknown, segments: PathSegment[]): unknown {
  let current = data
  for (const seg of segments) {
    current = (current as Record<string, unknown>)[String(seg)]
  }
  return current
}

function rebuildIndexMap(result: PatchSource): Map<string, number> {
  return new Map(result.elements.map((e, i) => [e.id, i]))
}

function collectSubtreeIds(result: PatchSource, elementId: string, indexMap: Map<string, number>): Set<string> {
  const collected = new Set<string>()
  const dfs = (eid: string) => {
    const idx = indexMap.get(eid)
    if (idx === undefined) return
    const children = result.elements[idx].children
    if (Array.isArray(children)) {
      for (const cid of children) {
        if (!collected.has(cid)) {
          collected.add(cid)
          dfs(cid)
        }
      }
    }
  }
  dfs(elementId)
  return collected
}

function applyDataAdd(result: PatchSource, op: DataAddOp) {
  const segments = parsePath(op.path)
  const state = result.state ?? (result.state = {})
  if (segments.length === 1) {
    const key = String(segments[0])
    if (key in state && Array.isArray(state[key]))
      (state[key] as unknown[]).push(op.value)
    else
      state[key] = op.value
    return
  }
  const parent = navigate(state, segments.slice(0, -1)) as Record<string, unknown>
  const last = segments[segments.length - 1]
  if (typeof last === "number") {
    (parent as unknown as unknown[]).splice(last, 0, op.value)
  } else if (typeof last === "string" && last in parent && Array.isArray(parent[last])) {
    (parent[last] as unknown[]).push(op.value)
  } else {
    parent[last] = op.value
  }
}

function applyDataReplace(result: PatchSource, op: DataReplaceOp) {
  const segments = parsePath(op.path)
  const state = result.state ?? (result.state = {})
  if (segments.length === 1) {
    state[String(segments[0])] = op.value
    return
  }
  const parent = navigate(state, segments.slice(0, -1)) as Record<string, unknown>
  parent[String(segments[segments.length - 1])] = op.value
}

function applyDataRemove(result: PatchSource, op: DataRemoveOp) {
  const segments = parsePath(op.path)
  const state = result.state ?? (result.state = {})
  if (segments.length === 1) {
    const key = String(segments[0])
    if (key in state) delete state[key]
    return
  }
  const parent = navigate(state, segments.slice(0, -1)) as Record<string, unknown> | unknown[]
  const last = segments[segments.length - 1]
  if (Array.isArray(parent) && typeof last === "number") {
    parent.splice(last, 1)
  } else if (parent && typeof parent === "object" && !Array.isArray(parent) && typeof last === "string" && last in parent) {
    delete parent[last]
  }
}

function applyIdRename(result: PatchSource, op: IdRenameOp, indexMap: Map<string, number>) {
  const idx = indexMap.get(op.old_id)
  if (idx === undefined) {
    console.warn(`id_rename: element '${op.old_id}' not found`)
    return
  }
  result.elements[idx].id = op.new_id

  for (const elem of result.elements) {
    if (Array.isArray(elem.children)) {
      elem.children = elem.children.map((cid) => (cid === op.old_id ? op.new_id : cid))
    } else if (elem.children && typeof elem.children === "object" && (elem.children as { componentId?: string }).componentId === op.old_id) {
      (elem.children as { componentId: string }).componentId = op.new_id
    }
    if (elem.props) {
      for (const val of Object.values(elem.props)) {
        if (val && typeof val === "object" && (val as { componentId?: string }).componentId === op.old_id) {
          (val as { componentId: string }).componentId = op.new_id
        }
      }
    }
  }

  if (result.rootId === op.old_id) result.rootId = op.new_id
}

function applyElementAdd(result: PatchSource, op: ElementAddOp) {
  result.elements.push(op.value)
}

function applyElementRemove(result: PatchSource, op: ElementRemoveOp, indexMap: Map<string, number>) {
  const removeSubtree = op.remove_subtree !== false
  const idsToRemove = new Set<string>([op.element_id])
  if (removeSubtree) {
    for (const id of collectSubtreeIds(result, op.element_id, indexMap)) {
      idsToRemove.add(id)
    }
  }

  for (const elem of result.elements) {
    if (Array.isArray(elem.children)) {
      const filtered = elem.children.filter((cid) => !idsToRemove.has(cid))
      if (filtered.length > 0) elem.children = filtered
      else delete elem.children
    }
  }

  for (const elem of result.elements) {
    if (!elem.props) continue
    for (const key of Object.keys(elem.props)) {
      const val = elem.props[key]
      if (val && typeof val === "object" && idsToRemove.has((val as { componentId?: string }).componentId ?? "")) {
        delete elem.props[key]
      }
    }
  }

  result.elements = result.elements.filter((e) => !idsToRemove.has(e.id))
}

function applyChildrenReplace(result: PatchSource, op: ChildrenReplaceOp, indexMap: Map<string, number>) {
  const idx = indexMap.get(op.element_id)
  if (idx === undefined) {
    console.warn(`children_replace: element '${op.element_id}' not found`)
    return
  }
  result.elements[idx].children = op.value
}

function applyPropsReplace(result: PatchSource, op: PropsReplaceOp, indexMap: Map<string, number>) {
  const idx = indexMap.get(op.element_id)
  if (idx === undefined) {
    console.warn(`props_replace: element '${op.element_id}' not found`)
    return
  }
  if (op.component) result.elements[idx].component = op.component
  result.elements[idx].props = op.value
}

export function mergeJson(source: PatchSource, patch: PatchOp[]): PatchSource {
  const result = structuredClone(source)
  const sorted = [...patch].sort((a, b) => (OP_ORDER[a.op] ?? 99) - (OP_ORDER[b.op] ?? 99))

  for (const op of sorted) {
    const indexMap = rebuildIndexMap(result)
    switch (op.op) {
      case "id_rename": applyIdRename(result, op, indexMap); break
      case "data_add": applyDataAdd(result, op); break
      case "data_replace": applyDataReplace(result, op); break
      case "data_remove": applyDataRemove(result, op); break
      case "element_add": applyElementAdd(result, op); break
      case "children_replace": applyChildrenReplace(result, op, indexMap); break
      case "element_remove": applyElementRemove(result, op, indexMap); break
      case "props_replace": applyPropsReplace(result, op, indexMap); break
      default: console.warn("Unknown op:", (op as PatchOp).op)
    }
  }

  return result
}
