import { Switch } from "@opencode-ai/ui/switch"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { For, Show, createSignal, createMemo, createResource, type JSX } from "solid-js"

export type Domain = { id: string; label: string }
export type ProductLine = { id: string; domainId: string; label: string }
export type Product = { id: string; productLineId: string; label: string; closed?: boolean }
export type Version = { value: string; label: string }
export interface ProjectSelection {
  directory: string
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
}

const CACHE_KEY = "octo-project-selection"

export function saveCachedSelection(data: ProjectSelection) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {}
}

export function loadCachedSelection(): ProjectSelection | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as ProjectSelection
  } catch {
    return undefined
  }
}

export async function fetchVersions(productId: string): Promise<Version[]> {
  const map: Record<string, Version[]> = {
    pypto: [
      { value: "v2612304", label: "v2612304" },
      { value: "v2612303", label: "v2612303" },
    ],
    ascend: [
      { value: "v260101", label: "v260101" },
    ],
    router: [
      { value: "v255001", label: "v255001" },
    ],
    switch: [
      { value: "v255002", label: "v255002" },
    ],
    "ecs-main": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ecs-auto": [
      { value: "v2612304", label: "v2612304" },
    ],
    "obs-main": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ms-lite": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ms-full": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ma-pro": [
      { value: "v2612304", label: "v2612304" },
    ],
  }
  return map[productId] ?? [{ value: "v2612304", label: "v2612304" }]
}

export type SearchResult = {
  domain: Domain
  productLine: ProductLine
  product: Product
}

export async function searchProducts(keyword: string): Promise<SearchResult[]> {
  if (!keyword) return []
  const lower = keyword.toLowerCase()
  const allDomains: Domain[] = [{ id: "ict", label: "ICT" }, { id: "cloud", label: "云计算" }, { id: "ai", label: "AI" }]
  const allProductLines: ProductLine[] = [
    { id: "cann", domainId: "ict", label: "CANN" },
    { id: "network", domainId: "ict", label: "网络" },
    { id: "storage", domainId: "ict", label: "存储" },
    { id: "server", domainId: "ict", label: "服务器" },
    { id: "ecs", domainId: "cloud", label: "ECS" },
    { id: "obs", domainId: "cloud", label: "OBS" },
    { id: "vpc", domainId: "cloud", label: "VPC" },
    { id: "elb", domainId: "cloud", label: "ELB" },
    { id: "mindspore", domainId: "ai", label: "MindSpore" },
    { id: "modelarts", domainId: "ai", label: "ModelArts" },
    { id: "hilens", domainId: "ai", label: "HiLens" },
  ]
  const allProducts: Product[] = [
    { id: "pypto", productLineId: "cann", label: "PYPTO" },
    { id: "ascend", productLineId: "cann", label: "AscendCL", closed: true },
    { id: "cann-toolkit", productLineId: "cann", label: "CANN Toolkit" },
    { id: "router", productLineId: "network", label: "路由器" },
    { id: "switch", productLineId: "network", label: "交换机", closed: true },
    { id: "firewall", productLineId: "network", label: "防火墙" },
    { id: "oceanstore", productLineId: "storage", label: "OceanStor" },
    { id: "fusionstorage", productLineId: "storage", label: "FusionStorage", closed: true },
    { id: "taishan", productLineId: "server", label: "泰山服务器" },
    { id: "kunpeng", productLineId: "server", label: "鲲鹏服务器" },
    { id: "ecs-main", productLineId: "ecs", label: "ECS主服务" },
    { id: "ecs-auto", productLineId: "ecs", label: "AutoScaling", closed: true },
    { id: "ecs-bare", productLineId: "ecs", label: "裸金属服务器" },
    { id: "obs-main", productLineId: "obs", label: "OBS主服务" },
    { id: "obs-archive", productLineId: "obs", label: "OBS归档存储" },
    { id: "vpc-core", productLineId: "vpc", label: "VPC核心" },
    { id: "vpc-peering", productLineId: "vpc", label: "VPC对等连接" },
    { id: "elb-share", productLineId: "elb", label: "共享型ELB" },
    { id: "elb-dedicated", productLineId: "elb", label: "独享型ELB" },
    { id: "ms-lite", productLineId: "mindspore", label: "MindSpore Lite" },
    { id: "ms-full", productLineId: "mindspore", label: "MindSpore全栈", closed: true },
    { id: "ms-serving", productLineId: "mindspore", label: "MindSpore Serving" },
    { id: "ma-pro", productLineId: "modelarts", label: "ModelArts Pro", closed: true },
    { id: "ma-studio", productLineId: "modelarts", label: "ModelArts Studio" },
    { id: "hilens-kit", productLineId: "hilens", label: "HiLens Kit" },
    { id: "hilens-studio", productLineId: "hilens", label: "HiLens Studio" },
  ]
  const results: SearchResult[] = []
  for (const product of allProducts) {
    if (product.label.toLowerCase().includes(lower)) {
      const productLine = allProductLines.find((pl) => pl.id === product.productLineId)
      const domain = allDomains.find((d) => d.id === productLine?.domainId)
      if (productLine && domain) {
        results.push({ domain, productLine, product })
      }
    }
  }
  return results
}

function autoSelect<T extends { id: string }>(list: T[] | undefined, prevId: string | undefined, fallback: T | undefined): T | undefined {
  if (!list?.length) return undefined
  if (prevId) {
    const prev = list.find((x) => x.id === prevId)
    if (prev) return prev
  }
  return fallback ?? list[0]
}

interface PanelProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  hideClosed: boolean
  search: string
  onDomainChange: (v: Domain | undefined) => void
  onProductLineChange: (v: ProductLine | undefined) => void
  onProductChange: (v: Product | undefined) => void
  onHideClosedChange: (v: boolean) => void
  onSearchChange: (v: string) => void
}

export function ProjectProductSelectPanel(props: PanelProps): JSX.Element {
  const [selectedDomainId, setSelectedDomainId] = createSignal(props.domain?.id)
  const [selectedProductLineId, setSelectedProductLineId] = createSignal(props.productLine?.id)
  const [selectedProductId, setSelectedProductId] = createSignal(props.product?.id)

  const [searchResults] = createResource(() => props.search, searchProducts)
  const isSearching = () => !!props.search

  const domains = createMemo(() => [{ id: "ict", label: "ICT" }, { id: "cloud", label: "云计算" }, { id: "ai", label: "AI" }])

  const productLineMap: Record<string, ProductLine[]> = {
    ict: [
      { id: "cann", domainId: "ict", label: "CANN" },
      { id: "network", domainId: "ict", label: "网络" },
      { id: "storage", domainId: "ict", label: "存储" },
      { id: "server", domainId: "ict", label: "服务器" },
    ],
    cloud: [
      { id: "ecs", domainId: "cloud", label: "ECS" },
      { id: "obs", domainId: "cloud", label: "OBS" },
      { id: "vpc", domainId: "cloud", label: "VPC" },
      { id: "elb", domainId: "cloud", label: "ELB" },
    ],
    ai: [
      { id: "mindspore", domainId: "ai", label: "MindSpore" },
      { id: "modelarts", domainId: "ai", label: "ModelArts" },
      { id: "hilens", domainId: "ai", label: "HiLens" },
    ],
  }
  const productLines = createMemo(() => {
    const id = selectedDomainId()
    if (!id) return []
    return productLineMap[id] ?? []
  })

  const productMap: Record<string, Product[]> = {
    cann: [
      { id: "pypto", productLineId: "cann", label: "PYPTO" },
      { id: "ascend", productLineId: "cann", label: "AscendCL", closed: true },
      { id: "cann-toolkit", productLineId: "cann", label: "CANN Toolkit" },
    ],
    network: [
      { id: "router", productLineId: "network", label: "路由器" },
      { id: "switch", productLineId: "network", label: "交换机", closed: true },
      { id: "firewall", productLineId: "network", label: "防火墙" },
    ],
    storage: [
      { id: "oceanstore", productLineId: "storage", label: "OceanStor" },
      { id: "fusionstorage", productLineId: "storage", label: "FusionStorage", closed: true },
    ],
    server: [
      { id: "taishan", productLineId: "server", label: "泰山服务器" },
      { id: "kunpeng", productLineId: "server", label: "鲲鹏服务器" },
    ],
    ecs: [
      { id: "ecs-main", productLineId: "ecs", label: "ECS主服务" },
      { id: "ecs-auto", productLineId: "ecs", label: "AutoScaling", closed: true },
      { id: "ecs-bare", productLineId: "ecs", label: "裸金属服务器" },
    ],
    obs: [
      { id: "obs-main", productLineId: "obs", label: "OBS主服务" },
      { id: "obs-archive", productLineId: "obs", label: "OBS归档存储" },
    ],
    vpc: [
      { id: "vpc-core", productLineId: "vpc", label: "VPC核心" },
      { id: "vpc-peering", productLineId: "vpc", label: "VPC对等连接" },
    ],
    elb: [
      { id: "elb-share", productLineId: "elb", label: "共享型ELB" },
      { id: "elb-dedicated", productLineId: "elb", label: "独享型ELB" },
    ],
    mindspore: [
      { id: "ms-lite", productLineId: "mindspore", label: "MindSpore Lite" },
      { id: "ms-full", productLineId: "mindspore", label: "MindSpore全栈", closed: true },
      { id: "ms-serving", productLineId: "mindspore", label: "MindSpore Serving" },
    ],
    modelarts: [
      { id: "ma-pro", productLineId: "modelarts", label: "ModelArts Pro", closed: true },
      { id: "ma-studio", productLineId: "modelarts", label: "ModelArts Studio" },
    ],
    hilens: [
      { id: "hilens-kit", productLineId: "hilens", label: "HiLens Kit" },
      { id: "hilens-studio", productLineId: "hilens", label: "HiLens Studio" },
    ],
  }

  const allProducts = createMemo(() => {
    const id = selectedProductLineId()
    if (!id) return []
    return productMap[id] ?? []
  })

  const filteredProducts = () => {
    const list = allProducts() ?? []
    let result = list
    if (props.hideClosed) result = result.filter((x) => !x.closed)
    if (props.search) result = result.filter((x) => x.label.toLowerCase().includes(props.search.toLowerCase()))
    return result
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <style>{`
        .panel-item { font-size: 13px; padding: 6px 8px; cursor: pointer; border-radius: 6px; margin-bottom: 2px; }
        .panel-item-selected { background: rgba(37, 99, 235, 0.08); color: #2563EB; }
      `}</style>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "margin-bottom": "8px",
        }}
      >
        <span style={{ "font-size": "14px", "line-height": "22px", color: "#191919", "flex-shrink": "0", background: "rgba(0,0,0,0.04)", padding: "2px 8px", "border-radius": "4px" }}>
          全部项目
        </span>
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-left": "20px" }}>
          <span style={{ "font-size": "12px", color: "rgba(0,0,0,0.5)" }}>隐藏已结项</span>
          <div class="panel-switch">
            <Switch
              checked={props.hideClosed}
              onChange={props.onHideClosedChange}
              hideLabel
            />
          </div>
        </div>
        <div style={{ width: "160px", "margin-left": "auto", position: "relative" }}>
          <InlineInput
            placeholder="搜索项目"
            value={props.search}
            onInput={(e) => props.onSearchChange(e.currentTarget.value)}
            style={{
              width: "100%",
              "font-size": "12px",
              border: "1px solid rgba(0,0,0,0.1)",
              "border-radius": "6px",
              padding: "6px 32px 6px 10px",
              height: "28px",
              background: "rgba(0,0,0,0.02)",
              outline: "none",
            }}
          />
          <Show when={props.search} fallback={
            <svg style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", "pointer-events": "none" }} width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" />
              <path d="M11 11L14 14" stroke="rgba(0,0,0,0.3)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          }>
            <svg
              style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", cursor: "pointer" }}
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              onClick={(e) => {
                e.stopPropagation()
                props.onSearchChange("")
              }}
            >
              <path d="M4 4L12 12M12 4L4 12" stroke="rgba(0,0,0,0.4)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </Show>
        </div>
      </div>
      <Show when={isSearching()} fallback={
        <div style={{ display: "flex"}}>
          <div style={{ flex: "1", "border-right": "1px solid rgba(0,0,0,0.08)", padding: "12px 8px" }}>
            <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>领域</div>
            <div style={{ "max-height": "240px", overflow: "auto" }}>
              <For each={domains() ?? []}>
                {(item) => (
                  <div
                    classList={{ "panel-item": true, "panel-item-selected": item.id === selectedDomainId() }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (item.id === selectedDomainId()) return
                      setSelectedDomainId(item.id)
                      props.onDomainChange(item)
                      const nextPL = (productLineMap[item.id] ?? [])[0]
                      setSelectedProductLineId(nextPL?.id)
                      props.onProductLineChange(nextPL)
                      const nextP = nextPL ? (productMap[nextPL.id] ?? [])[0] : undefined
                      setSelectedProductId(nextP?.id)
                      props.onProductChange(nextP)
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </div>
          <div style={{ flex: "1", "border-right": "1px solid rgba(0,0,0,0.08)", padding: "12px 8px" }}>
            <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品线</div>
            <div style={{ "max-height": "240px", overflow: "auto" }}>
              <For each={productLines() ?? []}>
                {(item) => (
                  <div
                    classList={{ "panel-item": true, "panel-item-selected": item.id === selectedProductLineId() }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (item.id === selectedProductLineId()) return
                      setSelectedProductLineId(item.id)
                      props.onProductLineChange(item)
                      const nextP = (productMap[item.id] ?? [])[0]
                      setSelectedProductId(nextP?.id)
                      props.onProductChange(nextP)
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </div>
          <div style={{ flex: "1", padding: "12px 8px" }}>
            <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品</div>
            <div style={{ "max-height": "240px", overflow: "auto" }}>
              <For each={filteredProducts()}>
                {(item) => (
                  <div
                    classList={{ "panel-item": true, "panel-item-selected": item.id === selectedProductId() }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (item.id === selectedProductId()) return
                      setSelectedProductId(item.id)
                      props.onProductChange(item)
                    }}
                  >
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      }>
        <div style={{ padding: "12px 8px", "max-height": "280px", overflow: "auto" }}>
          <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>搜索结果</div>
          <For each={searchResults() ?? []}>
            {(result) => (
              <div
                classList={{ "panel-item": true, "panel-item-selected": result.product.id === selectedProductId() }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onDomainChange(result.domain)
                  setSelectedDomainId(result.domain.id)
                  props.onProductLineChange(result.productLine)
                  setSelectedProductLineId(result.productLine.id)
                  props.onProductChange(result.product)
                  setSelectedProductId(result.product.id)
                }}
              >
                <span style={{ color: "rgba(0,0,0,0.4)", "font-size": "12px" }}>{result.domain.label}</span>
                <span style={{ color: "rgba(0,0,0,0.3)", "margin": "0 4px" }}>/</span>
                <span style={{ color: "rgba(0,0,0,0.4)", "font-size": "12px" }}>{result.productLine.label}</span>
                <span style={{ color: "rgba(0,0,0,0.3)", "margin": "0 4px" }}>/</span>
                <span style={{ "font-weight": 500 }}>{result.product.label}</span>
              </div>
            )}
          </For>
          <Show when={(searchResults() ?? []).length === 0}>
            <div style={{ padding: "16px 8px", "text-align": "center", color: "rgba(0,0,0,0.4)", "font-size": "13px" }}>
              未找到匹配的产品
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

