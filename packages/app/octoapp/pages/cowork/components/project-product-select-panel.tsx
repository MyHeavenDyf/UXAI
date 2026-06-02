import { Switch } from "@opencode-ai/ui/switch"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { For, Show, createSignal, createResource, type JSX } from "solid-js"
import { fetchDomains, fetchProductLines, fetchProducts, searchProducts } from "./project-product-select-api"

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

  const [domains] = createResource(fetchDomains)
  const [productLines] = createResource(() => selectedDomainId(), fetchProductLines)
  const [allProducts] = createResource(() => selectedProductLineId(), fetchProducts)

  const filteredProducts = () => {
    const list = allProducts() ?? []
    let result = list
    if (props.hideClosed) result = result.filter((x) => !x.closed)
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
                      setSelectedProductLineId(undefined)
                      setSelectedProductId(undefined)
                      props.onDomainChange(item)
                      props.onProductLineChange(undefined)
                      props.onProductChange(undefined)
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
                      setSelectedProductId(undefined)
                      props.onProductLineChange(item)
                      props.onProductChange(undefined)
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

