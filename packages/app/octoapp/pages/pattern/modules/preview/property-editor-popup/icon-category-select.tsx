import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { IconGroupNode } from "./icon-plus-fetch"

/** 图标库分类树（来自资源接口 resource_type=3 / source_id=6；接口未返回前作兜底） */
export type IconCategoryNode = IconGroupNode

const ICON_CATEGORY_TREE: IconCategoryNode[] = [
  {
    id: 74, name: '系统图标', children: [
      { id: 803, name: '1.0', resource_count: 455 },
    ],
  },
  {
    id: 76, name: '业务领域图标', children: [
      {
        id: 77, name: 'ICT产品与解决方案', children: [
          { id: 804, name: '1.0', resource_count: 1187 },
          { id: 805, name: '2.0', resource_count: 1538 },
        ],
      },
      {
        id: 80, name: '数字能源', children: [
          { id: 806, name: '1.0', resource_count: 360 },
          { id: 807, name: '2.0', resource_count: 496 },
        ],
      },
      {
        id: 83, name: '质量与流程IT', children: [
          { id: 802, name: '1.0', resource_count: 101 },
          { id: 808, name: '2.0', resource_count: 542 },
        ],
      },
      { id: 87, name: '华为云', children: [{ id: 809, name: '1.0', resource_count: 440 }] },
      { id: 89, name: '终端BG', children: [{ id: 810, name: '1.0', resource_count: 15 }] },
      { id: 91, name: '企业BG', children: [{ id: 811, name: '1.0', resource_count: 126 }] },
      {
        id: 93, name: '全球技术服务部（GTS）', children: [
          { id: 814, name: '1.0', resource_count: 15 },
          { id: 815, name: '2.0', resource_count: 571 },
        ],
      },
      { id: 96, name: '智能汽车解决方案BU', children: [{ id: 812, name: '1.0', resource_count: 73 }] },
      {
        id: 98, name: '半导体', children: [
          { id: 816, name: '1.0', resource_count: 33 },
          { id: 817, name: '2.0', resource_count: 31 },
        ],
      },
      { id: 101, name: 'Dev UI', children: [{ id: 813, name: '1.0', resource_count: 3 }] },
    ],
  },
]

/** 分类筛选树：剔除带 resource_count 的版本内容节点（如 1.0/2.0），其余节点即筛选项 */
const toFilterNode = (n: IconCategoryNode): IconCategoryNode | null => {
  if (n.resource_count) return null
  return { ...n, children: (n.children ?? []).map(toFilterNode).filter((c): c is IconCategoryNode => !!c) }
}
const buildFilterTree = (tree: IconCategoryNode[]): IconCategoryNode[] =>
  tree.map(toFilterNode).filter((n): n is IconCategoryNode => !!n)

/** 自身或任一后代被选中即视为选中态（父选项跟随子选项高亮） */
const containsSelected = (n: IconCategoryNode, id: number | 'all'): boolean =>
  n.id === id || !!(n.children ?? []).some(c => containsSelected(c, id))

/** 分类树行：整行点击选中；有子节点时右侧箭头展开/收起 */
function CategoryRow(props: {
  node: IconCategoryNode
  depth: number
  selectedId: number | 'all'
  expanded: () => Set<number>
  onSelect: (n: IconCategoryNode) => void
  onToggle: (id: number) => void
}) {
  const hasChildren = !!props.node.children?.length
  const isOpen = () => props.expanded().has(props.node.id)
  return (
    <div>
      <div class="flex h-[28px] cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] hover:bg-[#f3f4f6]"
        classList={{ 'bg-[#E6F2FD] font-medium text-primary': containsSelected(props.node, props.selectedId) }}
        style={{ 'padding-left': `${8 + props.depth * 16}px` }}
        onClick={() => props.onSelect(props.node)}>
        {hasChildren ? (
          <button type="button" class="flex h-[14px] w-[14px] shrink-0 items-center justify-center text-slate-400 hover:text-slate-600"
            onClick={(e) => { e.stopPropagation(); props.onToggle(props.node.id) }}>
            <svg class="block h-[10px] w-[10px] transition-transform" classList={{ 'rotate-90': isOpen() }} viewBox="0 0 8 8" fill="none">
              <path d="M2 1L5.5 4L2 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        ) : (
          <span class="h-[14px] w-[14px] shrink-0" />
        )}
        <span class="truncate leading-[14px]" style={{ color: '#191919' }}>{props.node.name}</span>
      </div>
      <Show when={hasChildren && isOpen()}>
        <For each={props.node.children}>
          {(c) => (
            <CategoryRow node={c} depth={props.depth + 1} selectedId={props.selectedId}
              expanded={props.expanded} onSelect={props.onSelect} onToggle={props.onToggle} />
          )}
        </For>
      </Show>
    </div>
  )
}

/** 图标分类树选择器：一级/二级节点均可选，带子集的节点可展开/收起 */
export function IconCategorySelect(props: {
  value: number | 'all'
  label: string
  /** 分组树（来自 store groups 接口）；未传或空时回退硬编码 ICON_CATEGORY_TREE */
  tree?: IconCategoryNode[]
  onChange: (id: number | 'all', name: string) => void
}) {
  /** 派生筛选树：剔除带 resource_count 的版本叶节点；无 prop 树时回退硬编码兜底 */
  const filterTree = () => buildFilterTree(props.tree?.length ? props.tree : ICON_CATEGORY_TREE)
  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal(new Set<number>(filterTree().filter(n => n.children?.length).map(n => n.id)))
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 })
  let btnRef!: HTMLButtonElement
  let listRef!: HTMLDivElement
  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      if (listRef && !listRef.contains(e.target as Node) && !btnRef.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      const t = e.target as Node
      if (listRef && (t === listRef || listRef.contains(t))) return
      setOpen(false)
    }
    if (btnRef) {
      const r = btnRef.getBoundingClientRect()
      setPos({ x: r.left, y: r.bottom + 4, w: r.width })
      requestAnimationFrame(() => {
        if (!listRef) return
        const lr = listRef.getBoundingClientRect()
        if (!lr.height) return
        const fitsDown = r.bottom + 4 + lr.height <= window.innerHeight
        const ay = fitsDown ? r.bottom + 4 : Math.max(4, r.top - 4 - lr.height)
        setPos({ x: r.left, y: ay, w: r.width })
      })
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
    })
  })
  const toggleExpand = (id: number) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const select = (id: number | 'all', name: string) => {
    props.onChange(id, name)
    setOpen(false)
  }
  return (
    <div class="relative flex-1">
      <button ref={btnRef} type="button" onClick={() => setOpen(!open())}
        class="flex h-9 w-full items-center rounded-[36px] border border-transparent bg-[#F2F3F5] px-3 text-left text-[12px] text-[#333333] outline-none">
        <span class="flex-1 truncate">{props.label}</span>
        <svg class="ml-1 h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div ref={listRef} data-custom-select-list class="icon-picker-scroll fixed z-[2147483646] max-h-[320px] overflow-y-auto rounded-lg border border-[#e5e7eb] py-1"
            style={{ left: pos().x + 'px', top: pos().y + 'px', 'min-width': '260px', background: '#fff', 'box-shadow': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)' }}>
            <div class="flex h-[28px] cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] hover:bg-[#f3f4f6]"
              classList={{ 'bg-[#E6F2FD] font-medium text-primary': props.value === 'all' }}
              onClick={() => select('all', '全部分类')}>
              <span class="h-[14px] w-[14px] shrink-0" />
              <span class="leading-[14px]" style={{ color: '#191919' }}>全部分类</span>
            </div>
            <For each={filterTree()}>
              {(n) => (
                <CategoryRow node={n} depth={0} selectedId={props.value} expanded={expanded}
                  onSelect={(nd) => select(nd.id, nd.name)} onToggle={toggleExpand} />
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
