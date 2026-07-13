import { createSignal, For, Show, createMemo, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"

export interface DomainNode {
  id: number
  name: string
  parentId: number
  sort: number
  industryId?: number
}

export interface SubDomainNode {
  id: number
  name: string
  parentId: number
  sort: number
}

export interface ProductNode {
  id: number
  name: string
  parentId: number
  sort: number
  commonTeam?: number
  deliveryTypeId?: number
  isSecret?: boolean
}

export interface NestedTreeNode {
  id: number
  label: string
  level?: number
  teamType?: number
  activityId?: number
  permissionFlag?: boolean
  parentId?: number
  deliveryTypeId?: number
  baseTeam?: number
  children?: NestedTreeNode[]
}

export interface ProductTreeData {
  domain: DomainNode[]
  subDomains: SubDomainNode[]
  products: ProductNode[]
}

export type TreeDataInput = ProductTreeData | NestedTreeNode[]

interface Props {
  data: TreeDataInput
  leafOnly: boolean
  selectedId: number | null
  selectedLabel?: string
  onSelect: (id: number, item: TreeNodeItem) => void
  searchPlaceholder?: string
  triggerPlaceholder?: string
  maxHeight?: string
}

export type TreeNodeItem = DomainNode | SubDomainNode | ProductNode | NestedTreeNode

interface InternalTreeNode {
  id: number
  name: string
  level: number
  isLeaf: boolean
  hasChildren: boolean
  children: InternalTreeNode[]
  originalData: TreeNodeItem
}

function buildProductTree(data: ProductTreeData): InternalTreeNode[] {
  const domainMap = new Map<number, DomainNode>()
  const subDomainMap = new Map<number, SubDomainNode>()
  const productMap = new Map<number, ProductNode>()
  const subDomainChildren = new Map<number, SubDomainNode[]>()
  const productChildren = new Map<number, ProductNode[]>()

  data.domain.forEach(d => domainMap.set(d.id, d))
  data.subDomains.forEach(s => {
    subDomainMap.set(s.id, s)
    const arr = subDomainChildren.get(s.parentId) || []
    arr.push(s)
    subDomainChildren.set(s.parentId, arr)
  })
  data.products.forEach(p => {
    productMap.set(p.id, p)
    const arr = productChildren.get(p.parentId) || []
    arr.push(p)
    productChildren.set(p.parentId, arr)
  })

  function buildSubDomainTree(subDomain: SubDomainNode, level: number): InternalTreeNode {
    const childSubDomains = subDomainChildren.get(subDomain.id) || []
    const childProducts = productChildren.get(subDomain.id) || []

    const children: InternalTreeNode[] = []

    childSubDomains
      .sort((a, b) => a.sort - b.sort)
      .forEach(sd => children.push(buildSubDomainTree(sd, level + 1)))

    childProducts
      .sort((a, b) => a.sort - b.sort)
      .forEach(p => children.push({
        id: p.id,
        name: p.name,
        level: level + 1,
        isLeaf: true,
        hasChildren: false,
        children: [],
        originalData: p
      }))

    return {
      id: subDomain.id,
      name: subDomain.name,
      level,
      isLeaf: childSubDomains.length === 0 && childProducts.length === 0,
      hasChildren: children.length > 0,
      children,
      originalData: subDomain
    }
  }

  const roots: InternalTreeNode[] = []

  data.domain
    .sort((a, b) => a.sort - b.sort)
    .forEach(d => {
      const childSubDomains = subDomainChildren.get(d.id) || []
      const childProducts = productChildren.get(d.id) || []

      const children: InternalTreeNode[] = []

      childSubDomains
        .sort((a, b) => a.sort - b.sort)
        .forEach(sd => children.push(buildSubDomainTree(sd, 1)))

      childProducts
        .sort((a, b) => a.sort - b.sort)
        .forEach(p => children.push({
          id: p.id,
          name: p.name,
          level: 1,
          isLeaf: true,
          hasChildren: false,
          children: [],
          originalData: p
        }))

      roots.push({
        id: d.id,
        name: d.name,
        level: 0,
        isLeaf: childSubDomains.length === 0 && childProducts.length === 0,
        hasChildren: children.length > 0,
        children,
        originalData: d
      })
    })

  return roots
}

function buildNestedTree(data: NestedTreeNode[], level: number = 0): InternalTreeNode[] {
  return data.map(node => {
    const children = node.children ? buildNestedTree(node.children, level + 1) : []
    return {
      id: node.id,
      name: node.label,
      level,
      isLeaf: children.length === 0,
      hasChildren: children.length > 0,
      children,
      originalData: node
    }
  })
}

function flattenTreeForSearch(nodes: InternalTreeNode[]): InternalTreeNode[] {
  const result: InternalTreeNode[] = []
  function traverse(n: InternalTreeNode[]) {
    n.forEach(node => {
      result.push(node)
      if (node.children.length > 0) traverse(node.children)
    })
  }
  traverse(nodes)
  return result
}

export function ArchiveTreeSelector(props: Props): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [searchText, setSearchText] = createSignal("")
  const [expandedIds, setExpandedIds] = createSignal<Set<number>>(new Set())
  let triggerRef: HTMLButtonElement | undefined

  const tree = createMemo(() => {
    const data = props.data
    if (data && 'domain' in data && 'subDomains' in data && 'products' in data) {
      return buildProductTree(data as ProductTreeData)
    }
    if (Array.isArray(data) && data.length > 0 && 'label' in data[0]) {
      return buildNestedTree(data as NestedTreeNode[])
    }
    return []
  })

  const filteredNodes = createMemo(() => {
    const search = searchText().toLowerCase().trim()
    if (!search) return tree()

    const flat = flattenTreeForSearch(tree())
    const matching = flat.filter(n => n.name.toLowerCase().includes(search))

    const matchingIds = new Set(matching.map(n => n.id))
    const parentIds = new Set<number>()

    flat.forEach(n => {
      if (matchingIds.has(n.id)) {
        function addParents(node: InternalTreeNode) {
          flat.forEach(p => {
            if (p.children.some(c => c.id === node.id)) {
              parentIds.add(p.id)
              addParents(p)
            }
          })
        }
        addParents(n)
      }
    })

    function filterTree(nodes: InternalTreeNode[]): InternalTreeNode[] {
      return nodes
        .filter(n => matchingIds.has(n.id) || parentIds.has(n.id))
        .map(n => ({
          ...n,
          children: filterTree(n.children)
        }))
    }

    return filterTree(tree())
  })

  const toggleExpand = (id: number) => {
    const current = expandedIds()
    const newSet = new Set(current)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setExpandedIds(newSet)
  }

  const handleSelect = (node: InternalTreeNode) => {
    if (props.leafOnly && !node.isLeaf) return
    props.onSelect(node.id, node.originalData)
    setOpen(false)
    setSearchText("")
  }

  const isExpanded = (id: number) => {
    const search = searchText().toLowerCase().trim()
    if (search) {
      const flat = flattenTreeForSearch(tree())
      const matching = flat.filter(n => n.name.toLowerCase().includes(search))
      const matchingIds = new Set(matching.map(n => n.id))
      if (matchingIds.has(id)) return true

      const parentIds = new Set<number>()
      flat.forEach(n => {
        if (matchingIds.has(n.id)) {
          function addParents(node: InternalTreeNode) {
            flat.forEach(p => {
              if (p.children.some(c => c.id === node.id)) {
                parentIds.add(p.id)
                addParents(p)
              }
            })
          }
          addParents(n)
        }
      })
      return parentIds.has(id)
    }
    return expandedIds().has(id)
  }

  const TreeNodeRow = (rowProps: { node: InternalTreeNode; depth: number; leafOnly: boolean }) => {
    const node = rowProps.node
    const depth = rowProps.depth
    const canSelect = !rowProps.leafOnly || node.isLeaf

    return (
      <>
        <div
          class="archive-tree-node"
          classList={{
            "archive-tree-node-selected": props.selectedId === node.id,
            "archive-tree-node-disabled": !canSelect
          }}
          style={{ "padding-left": `${depth * 16 + 8}px` }}
          onClick={() => canSelect && handleSelect(node)}
        >
          <Show when={node.hasChildren}>
            <button
              type="button"
              class="archive-tree-expand-btn"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(node.id)
              }}
            >
              <span style={{ transform: isExpanded(node.id) ? "rotate(90deg)" : "none", display: "inline-block" }}>
                ▶
              </span>
            </button>
          </Show>
          <Show when={!node.hasChildren}>
            <span class="archive-tree-expand-placeholder" />
          </Show>
          <span class="archive-tree-node-name">{node.name}</span>
        </div>
        <Show when={node.hasChildren && isExpanded(node.id)}>
          <For each={node.children}>
            {child => <TreeNodeRow node={child} depth={depth + 1} leafOnly={rowProps.leafOnly} />}
          </For>
        </Show>
      </>
    )
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (!open()) return
    const target = e.target as HTMLElement
    if (triggerRef && !triggerRef.contains(target)) {
      const popup = document.querySelector(".archive-tree-popup")
      if (popup && !popup.contains(target)) {
        setOpen(false)
        setSearchText("")
      }
    }
  }

  createEffect(() => {
    if (open()) {
      document.addEventListener("click", handleClickOutside)
    } else {
      document.removeEventListener("click", handleClickOutside)
    }
    onCleanup(() => {
      document.removeEventListener("click", handleClickOutside)
    })
  })

  const displayText = () => props.selectedLabel || props.triggerPlaceholder || "请选择"

  const popupStyle = () => {
    if (!triggerRef) return {}
    const rect = triggerRef.getBoundingClientRect()
    return {
      position: "fixed" as const,
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 300)}px`,
      "z-index": 10001
    }
  }

  return (
    <div class="archive-tree-selector">
      <button
        ref={triggerRef}
        type="button"
        class="archive-tree-trigger"
        onClick={() => setOpen(!open())}
      >
        <span class="archive-tree-trigger-text">{displayText()}</span>
        <span class="archive-tree-trigger-icon" style={{ transform: open() ? "rotate(180deg)" : "none" }}>
          ▼
        </span>
      </button>

      <Show when={open()}>
        <Portal mount={document.body}>
          <div class="archive-tree-popup" style={popupStyle()}>
            <div class="archive-tree-search">
              <input
                type="text"
                placeholder={props.searchPlaceholder || "搜索..."}
                value={searchText()}
                onInput={(e) => setSearchText(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div
              class="archive-tree-list"
              style={{ "max-height": props.maxHeight || "250px" }}
            >
              <Show when={filteredNodes().length === 0}>
                <div class="archive-tree-empty">无匹配结果</div>
              </Show>
              <For each={filteredNodes()}>
                {node => <TreeNodeRow node={node} depth={0} leafOnly={props.leafOnly} />}
              </For>
            </div>
          </div>
        </Portal>
      </Show>

      <style>{`
        .archive-tree-selector {
          position: relative;
        }
        .archive-tree-trigger {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--octo-border-default);
          border-radius: 6px;
          background: var(--octo-surface-default);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }
        .archive-tree-trigger:hover {
          border-color: var(--octo-border-focus);
        }
        .archive-tree-trigger-text {
          flex: 1;
          text-align: left;
          color: var(--octo-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .archive-tree-trigger-icon {
          font-size: 10px;
          color: var(--octo-text-secondary);
          transition: transform 0.15s;
        }
        .archive-tree-popup {
          background: #ffffff;
          border: 1px solid var(--octo-border-default);
          border-radius: 8px;
          box-shadow: var(--octo-shadow-lg);
          overflow: hidden;
        }
        .archive-tree-search {
          padding: 8px;
          border-bottom: 1px solid var(--octo-border-subtle);
        }
        .archive-tree-search input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--octo-border-default);
          border-radius: 4px;
          font-size: 13px;
          outline: none;
        }
        .archive-tree-search input:focus {
          border-color: var(--octo-border-focus);
        }
        .archive-tree-list {
          overflow-y: auto;
        }
        .archive-tree-node {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 8px;
          cursor: pointer;
          border-bottom: 1px solid var(--octo-border-subtle);
          transition: background 0.1s;
        }
        .archive-tree-node:last-child {
          border-bottom: none;
        }
        .archive-tree-node:hover {
          background: var(--octo-surface-hover);
        }
        .archive-tree-node-selected {
          background: rgba(37, 99, 235, 0.1);
        }
        .archive-tree-node-selected:hover {
          background: rgba(37, 99, 235, 0.15);
        }
        .archive-tree-node-disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .archive-tree-node-disabled:hover {
          background: transparent;
        }
        .archive-tree-expand-btn {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 10px;
          color: var(--octo-text-secondary);
        }
        .archive-tree-expand-placeholder {
          width: 20px;
        }
        .archive-tree-node-name {
          font-size: 13px;
          color: var(--octo-text-primary);
          flex: 1;
        }
        .archive-tree-empty {
          padding: 16px;
          text-align: center;
          color: var(--octo-text-secondary);
          font-size: 13px;
        }
      `}</style>
    </div>
  )
}