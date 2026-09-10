/**
 * 场景大纲面板（Phase 1.5）—— Spline 左侧「场景大纲」。
 *
 * 显示场景里所有元素/对象的树形大纲（逻辑根分组 + 子部件可展开折叠）。
 * - 点击大纲项 → SCENE_SELECT 高亮 + SCENE_FLY_TO 聚焦 + setPickedObj 弹属性面板
 * - canvas 点选 → SCENE_PICK 回传 → 大纲对应项高亮 + 自动展开父节点
 *
 * 数据来源：SCENE_QUERY_TREE 请求 → SCENE_TREE 回传（运行时 Object3D 树，含子部件层级）。
 * 由 preview/index.tsx 发 SCENE_QUERY_TREE + 收 SCENE_TREE → 传 treeNodes 给本组件。
 */
import { createSignal, createEffect, For, Show, createMemo, type JSX } from "solid-js"

/** 树节点（镜像 3d-templete SceneTreeNode） */
export interface OutlineNode {
  id: string
  name: string
  type?: string
  parentId: string | null
  isLogicalRoot?: boolean
  children?: string[]
  /** 运行时可见性（Object3D.visible，隐藏时灰显） */
  visible?: boolean
  /** 运行时锁定（userData.__locked，锁定后 picker 跳过） */
  locked?: boolean
}

export interface OutlinePanelProps {
  /** 场景树节点（SCENE_TREE 回传） */
  nodes: OutlineNode[]
  /** 当前选中 id（canvas 点选或大纲点击同步） */
  selectedId: string | null
  /** 大纲项点击 → 宿主发 SCENE_SELECT + SCENE_FLY_TO + setPickedObj */
  onSelect: (id: string) => void
  /** 选中项删除 → 复用 handleRemoveObject */
  onRemove?: (id: string) => void
  /** 选中项复制 → 复用 handleDuplicateObject */
  onDuplicate?: (id: string) => void
  /** 切换可见性 → 宿主发 SCENE_SET_VISIBLE（运行时态，不落盘） */
  onToggleVisibility?: (id: string) => void
  /** 切换锁定 → 宿主发 SCENE_SET_LOCKED（运行时态，不落盘） */
  onToggleLock?: (id: string) => void
  /** 双击重命名 → 宿主发 SCENE_RENAME（运行时态，不改 __id） */
  onRename?: (id: string, name: string) => void
  /** 右键上下文菜单 → 宿主弹菜单（id + 鼠标坐标） */
  onContextMenu?: (id: string, x: number, y: number) => void
  /** 滚动定位请求（canvas 点选时宿主设，大纲滚动到该项居中；nonce 变化触发） */
  scrollRequest?: { id: string; nonce: number } | null
}

/** 按 isLogicalRoot 分组根节点；非根节点按 parentId 挂到父 */
function buildTree(nodes: OutlineNode[]): {
  roots: OutlineNode[]
  childrenMap: Map<string, OutlineNode[]>
} {
  const childrenMap = new Map<string, OutlineNode[]>()
  const roots: OutlineNode[] = []
  for (const n of nodes) {
    if (n.isLogicalRoot || n.parentId === null) {
      roots.push(n)
    } else if (n.parentId) {
      const arr = childrenMap.get(n.parentId) ?? []
      arr.push(n)
      childrenMap.set(n.parentId, arr)
    }
  }
  return { roots, childrenMap }
}

const EyeOpenIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const EyeClosedIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)
const LockClosedIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const LockOpenIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
)

export function OutlinePanel(props: OutlinePanelProps): JSX.Element {
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set())
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal("")
  const tree = createMemo(() => buildTree(props.nodes))
  /** outline-body ref（用于 scrollIntoView 定位选中项） */
  let bodyRef: HTMLDivElement | undefined

  // 选中项在子树里 → 自动展开从根到选中项的整条祖先链（effect 驱动，不在渲染阶段写信号）
  createEffect(() => {
    const sel = props.selectedId
    if (!sel) return
    const all = tree()
    const nodeMap = new Map<string, OutlineNode>(all.roots.map((r) => [r.id, r]))
    // 所有非根节点也加入 map（buildTree 只给 roots，childrenMap 有全部）
    for (const [parentId, children] of all.childrenMap) {
      for (const c of children) nodeMap.set(c.id, c)
    }
    // 沿 parentId 链从选中项向上收集祖先
    const toExpand = new Set<string>()
    let cur = nodeMap.get(sel)
    while (cur && cur.parentId) {
      toExpand.add(cur.parentId)
      cur = nodeMap.get(cur.parentId)
    }
    if (toExpand.size === 0) return
    setExpandedIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of toExpand) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  })

  // 滚动定位：scrollRequest nonce 变化时滚动到目标项居中（仅 canvas 点选触发，大纲点击不滚）
  createEffect(() => {
    const req = props.scrollRequest
    if (!req) return
    // 消费 nonce（读 req.nonce 让 effect 依赖它，每次变化都触发）
    void req.nonce
    const sel = req.id
    // 先展开祖先链（确保 DOM 已渲染），再下一帧滚动
    const all = tree()
    const nodeMap = new Map<string, OutlineNode>(all.roots.map((r) => [r.id, r]))
    for (const [, children] of all.childrenMap) {
      for (const c of children) nodeMap.set(c.id, c)
    }
    const toExpand = new Set<string>()
    let cur = nodeMap.get(sel)
    while (cur && cur.parentId) {
      toExpand.add(cur.parentId)
      cur = nodeMap.get(cur.parentId)
    }
    if (toExpand.size > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        for (const id of toExpand) next.add(id)
        return next
      })
    }
    // 两帧后滚动（第一帧展开 DOM 渲染，第二帧定位）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = bodyRef?.querySelector<HTMLElement>(`[data-outline-id="${sel}"]`)
        el?.scrollIntoView({ block: "center", behavior: "smooth" })
      })
    })
  })

  function toggleExpand(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startRename(node: OutlineNode): void {
    setRenamingId(node.id)
    setRenameValue(node.name)
  }

  /** 防止 onBlur 在 Enter 提交后二次触发（input 卸载会再抛一次 blur） */
  let renameCommitted = false
  function commitRename(id: string): void {
    if (renameCommitted) return
    renameCommitted = true
    const val = renameValue().trim()
    setRenamingId(null)
    if (val && props.onRename) {
      props.onRename(id, val)
    }
    // 下一帧重置（允许下次 rename）
    requestAnimationFrame(() => { renameCommitted = false })
  }

  /** 渲染单个节点 + 递归渲染子节点（所有信号读取 inline，避免 render 闭包捕获 stale 值） */
  function renderNode(node: OutlineNode, depth: number): JSX.Element {
    return (
      <>
        <div
          class="outline-item"
          classList={{
            "outline-item-selected": props.selectedId === node.id,
            "outline-item-root": node.isLogicalRoot || node.parentId === null,
            "outline-item-hidden": node.visible === false,
            "outline-item-locked": node.locked === true,
          }}
          style={{ "padding-left": `${8 + depth * 14}px` }}
          data-outline-id={node.id}
          onClick={() => props.onSelect(node.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            props.onContextMenu?.(node.id, e.clientX, e.clientY)
          }}
        >
          <Show when={(tree().childrenMap.get(node.id)?.length ?? 0) > 0}>
            <button
              type="button"
              class="outline-toggle"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(node.id)
              }}
            >
              {(() => (expandedIds().has(node.id) ? "▾" : "▸"))()}
            </button>
          </Show>
          <Show when={(tree().childrenMap.get(node.id)?.length ?? 0) === 0}>
            <span class="outline-toggle-placeholder" />
          </Show>
          <Show
            when={renamingId() === node.id}
            fallback={
              <span
                class="outline-label"
                title={node.id}
                onDblClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  startRename(node)
                }}
              >
                {node.name}
              </span>
            }
          >
            <input
              ref={(el) => requestAnimationFrame(() => el.focus())}
              class="outline-rename-input"
              value={renameValue()}
              onFocus={(e) => e.target.select()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commitRename(node.id)
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setRenamingId(null)
                }
              }}
              onBlur={() => commitRename(node.id)}
              onClick={(e) => e.stopPropagation()}
              onDblClick={(e) => e.stopPropagation()}
            />
          </Show>
          <span class="outline-actions">
            <Show when={props.onToggleVisibility}>
              <button
                type="button"
                class="outline-action-btn"
                classList={{
                  "outline-action-btn-active": node.visible === false,
                  "outline-action-btn-persistent": node.visible === false,
                }}
                title={node.visible === false ? "显示" : "隐藏"}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onToggleVisibility?.(node.id)
                }}
              >
                {node.visible === false ? <EyeClosedIcon /> : <EyeOpenIcon />}
              </button>
            </Show>
            <Show when={props.onToggleLock}>
              <button
                type="button"
                class="outline-action-btn"
                classList={{
                  "outline-action-btn-active": node.locked === true,
                  "outline-action-btn-persistent": node.locked === true,
                }}
                title={node.locked === true ? "解锁" : "锁定"}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onToggleLock?.(node.id)
                }}
              >
                {node.locked === true ? <LockClosedIcon /> : <LockOpenIcon />}
              </button>
            </Show>
          </span>
        </div>
        <Show when={(tree().childrenMap.get(node.id)?.length ?? 0) > 0 && expandedIds().has(node.id)}>
          <For each={tree().childrenMap.get(node.id) ?? []}>
            {(child) => renderNode(child, depth + 1)}
          </For>
        </Show>
      </>
    )
  }

  return (
    <div class="outline-panel">
      <div class="outline-header">
        <span class="outline-title">场景大纲</span>
        <span class="outline-count">{props.nodes.length} 项</span>
      </div>
      <div class="outline-body" ref={bodyRef}>
        <Show
          when={props.nodes.length > 0}
          fallback={<div class="outline-empty">场景为空</div>}
        >
          <For each={tree().roots}>{(root) => renderNode(root, 0)}</For>
        </Show>
      </div>
    </div>
  )
}
