import { Switch } from "@opencode-ai/ui/switch"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { For, Show, Suspense, ErrorBoundary, createSignal, createResource, createEffect, type JSX } from "solid-js"
import { fetchDomains, fetchProductLines, fetchProducts, searchProducts, fetchDomainInfoByProduct, topProduct, cancelTopProduct, type Domain, type ProductLine, type Product, type Version, type SearchResult } from "./project-product-select-api"

export type { Domain, ProductLine, Product, Version }

export interface ProjectSelection {
  directory: string
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
}

interface PanelProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  onProductConfirm: (data: { domain?: Domain; productLine?: ProductLine; product?: Product }) => void
}

const emptyHintStyle = {
  padding: "24px 8px",
  "text-align": "center",
  color: "rgba(0,0,0,0.4)",
  "font-size": "13px",
  "line-height": "20px",
} as const

const errorPageStyle = {
  padding: "24px 8px",
  "text-align": "center",
} as const

function ErrorContent(props: { onRetry: () => void }) {
  return (
    <div style={errorPageStyle}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: "0 auto 8px" }}>
        <circle cx="20" cy="20" r="18" stroke="rgba(0,0,0,0.1)" stroke-width="1.5" fill="rgba(0,0,0,0.04)" />
        <path d="M14 16c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="rgba(0,0,0,0.2)" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="14" cy="16" r="2" fill="rgba(0,0,0,0.2)" />
        <circle cx="26" cy="16" r="2" fill="rgba(0,0,0,0.2)" />
        <path d="M14 24h12" stroke="rgba(0,0,0,0.2)" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <div style={{ color: "rgba(0,0,0,0.4)", "font-size": "13px", "line-height": "20px" }}>
        数据加载失败
        <div style={{ color: "rgba(0,0,0,0.3)", "font-size": "12px", "margin-top": "4px" }}>请检查网络连接后重试</div>
      </div>
      <button
        style={{
          margin: "12px auto 0",
          padding: "6px 16px",
          "font-size": "12px",
          color: "#2563EB",
          background: "rgba(37, 99, 235, 0.08)",
          border: "none",
          "border-radius": "4px",
          cursor: "pointer",
        }}
        onClick={props.onRetry}
      >
        重新加载
      </button>
    </div>
  )
}

export function ProjectProductSelectPanel(props: PanelProps): JSX.Element {
  const [selectedDomainId, setSelectedDomainId] = createSignal(props.domain?.id)
  const [selectedProductLineId, setSelectedProductLineId] = createSignal(props.productLine?.id)
  const [selectedProductId, setSelectedProductId] = createSignal(props.product?.id)
  const [hideClosed, setHideClosed] = createSignal(false)
  const [search, setSearch] = createSignal("")

  const [searchResults, { refetch: refetchSearchResults }] = createResource(() => search() || undefined, searchProducts)
  const isSearching = () => !!search()

  const [domains, { refetch: refetchDomains }] = createResource(fetchDomains)
  const [productLines] = createResource(() => selectedDomainId() ?? undefined, fetchProductLines)
  const [allProducts, { refetch: refetchProducts }] = createResource(() => selectedProductLineId() ?? undefined, fetchProducts)

  createEffect(() => {
    const list = domains()
    if (!list?.length) return
    if (!selectedDomainId()) setSelectedDomainId(list[0].id)
  })

  createEffect(() => {
    const list = productLines()
    if (!list?.length) return
    if (!list.some(item => item.id === selectedProductLineId())) setSelectedProductLineId(list[0].id)
  })

  const filteredProducts = () => {
    const list = allProducts() ?? []
    if (hideClosed()) return list.filter((x) => !x.isEnd)
    return list
  }

  const hasError = () => !!domains.error || !!productLines.error || !!allProducts.error

  const safeDomains = () => {
    try { return domains() ?? [] } catch { return [] }
  }
  const safeProductLines = () => {
    try { return productLines() ?? [] } catch { return [] }
  }
  const safeAllProducts = () => {
    try { return allProducts() ?? [] } catch { return [] }
  }
  const safeSearchResults = () => {
    try { return searchResults() ?? [] } catch { return [] }
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <style>{`
        .panel-item { font-size: 13px; padding: 6px 8px; cursor: pointer; border-radius: 6px; margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
        .panel-item-selected { background: rgba(37, 99, 235, 0.08); color: #2563EB; }
        .panel-item:not(.panel-item-selected):hover { background: #f3f3f3; }
        .panel-item .pin-action { visibility: hidden; margin-left: auto; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; }
        .panel-item:hover .pin-action { visibility: visible; }
        .closed-label { font-size: 11px; color: rgba(0,0,0,0.45); background: rgba(0,0,0,0.04); padding: 0 4px; border-radius: 2px; line-height: 18px; flex-shrink: 0; }
        .panel-item-disabled { color: rgba(0,0,0,0.3); cursor: not-allowed; }
        .panel-item-disabled:hover { background: transparent; }
        .panel-item-disabled .pin-action { visibility: hidden !important; }
        .secret-icon svg { color: #E53E3E; }
        .panel-item-selected .secret-icon svg { color: #2563EB; }
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
              checked={hideClosed()}
              onChange={setHideClosed}
              hideLabel
            />
          </div>
        </div>
        <div style={{ width: "160px", "margin-left": "auto", position: "relative" }}>
          <InlineInput
            placeholder="搜索项目"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
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
          <Show when={search()} fallback={
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
                setSearch("")
              }}
            >
              <path d="M4 4L12 12M12 4L4 12" stroke="rgba(0,0,0,0.4)" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </Show>
        </div>
      </div>
      <ErrorBoundary fallback={() => <ErrorContent onRetry={() => refetchDomains()} />}>
        <Show when={isSearching()}>
          <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
            <Show when={safeSearchResults().length > 0} fallback={<div style={emptyHintStyle}>未找到匹配的产品</div>}>
              <div style={{ padding: "12px 8px", "max-height": "280px", overflow: "auto" }}>
                <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>搜索结果</div>
<For each={safeSearchResults()}>
                  {(result) => {
                    const handleTopToggle = (e: MouseEvent) => {
                      e.stopPropagation()
                      const fn = result.isTop ? cancelTopProduct : topProduct
                      fn(result.productId).then(() => { refetchProducts(); refetchSearchResults() }).catch(() => {})
                    }
                    const isSecretDisabled = result.isSecret && !result.isProductMember
                    return (
                      <div
                        classList={{ "panel-item": true, "panel-item-selected": !isSecretDisabled && result.productId === selectedProductId(), "panel-item-disabled": isSecretDisabled }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isSecretDisabled) return
                          fetchDomainInfoByProduct(result.productId).then((info) => {
                            if (!info?.domain || !info?.subDomain || !info?.product) return
                            setSelectedDomainId(info.domain.id)
                            setSelectedProductLineId(info.subDomain.id)
                            setSelectedProductId(info.product.id)
                            props.onProductConfirm({
                              domain: info.domain,
                              productLine: info.subDomain,
                              product: info.product,
                            })
                          }).catch(() => {})
                        }}
                      >
                        <Show when={result.isTop}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ "flex-shrink": "0" }}>
                            <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
                          </svg>
                        </Show>
                        <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{result.name}</span>
                        <Show when={result.isSecret && !result.isProductMember}>
                          <span class="secret-icon" style={{ "flex-shrink": "0" }}>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                            </svg>
                          </span>
                        </Show>
                        <Show when={result.isEnd}>
                          <span class="closed-label">已结项</span>
                        </Show>
                        <span class="pin-action" onClick={handleTopToggle} onPointerDown={(e) => e.stopPropagation()}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <Show when={result.isTop} fallback={
                              <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
                            }>
                              <path d="M8 13L4 9h3V3h2v6h3L8 13z" fill="currentColor"/>
                            </Show>
                          </svg>
                        </span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Suspense>
        </Show>
        <Show when={!isSearching()}>
          <Show when={hasError()} fallback={
            <div style={{ display: "flex" }}>
              <div style={{ flex: "1", "border-right": "1px solid rgba(0,0,0,0.08)", padding: "12px 8px" }}>
                <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>领域</div>
                <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                  <Show when={safeDomains().length > 0} fallback={<div style={emptyHintStyle}>暂无领域数据</div>}>
                    <div style={{ "max-height": "240px", overflow: "auto" }}>
                      <For each={safeDomains()}>
                        {(item) => (
                          <div
                            classList={{ "panel-item": true, "panel-item-selected": item.id === selectedDomainId() }}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (item.id === selectedDomainId()) return
                              setSelectedDomainId(item.id)
                              setSelectedProductLineId(undefined)
                            }}
                          >
                            {item.name}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Suspense>
              </div>
              <div style={{ flex: "1", "border-right": "1px solid rgba(0,0,0,0.08)", padding: "12px 8px" }}>
                <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品线</div>
                <Show when={selectedDomainId()} fallback={<div style={emptyHintStyle}>请先选择领域</div>}>
                  <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                    <Show when={safeProductLines().length > 0} fallback={<div style={emptyHintStyle}>暂无产品线数据</div>}>
                      <div style={{ "max-height": "240px", overflow: "auto" }}>
                        <For each={safeProductLines()}>
                          {(item) => (
                            <div
                              classList={{ "panel-item": true, "panel-item-selected": item.id === selectedProductLineId() }}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (item.id === selectedProductLineId()) return
                                setSelectedProductLineId(item.id)
                              }}
                            >
                              {item.name}
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Suspense>
                </Show>
              </div>
              <div style={{ flex: "1", padding: "12px 8px" }}>
                <div style={{ "font-size": "13px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品</div>
                <Show when={selectedProductLineId()} fallback={<div style={emptyHintStyle}>请先选择产品线</div>}>
                  <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                    <Show when={safeAllProducts().length > 0 || filteredProducts().length > 0} fallback={<div style={emptyHintStyle}>暂无产品数据</div>}>
                      <div style={{ "max-height": "240px", overflow: "auto" }}>
                        <For each={filteredProducts()}>
                          {(item) => {
                            const handleTopToggle = (e: MouseEvent) => {
                              e.stopPropagation()
                              const fn = item.isTop ? cancelTopProduct : topProduct
                              fn(item.id).then(() => refetchProducts()).catch(() => {})
                            }
                            const isSecretDisabled = item.isSecret && !item.isProductMember
                            return (
                              <div
                                classList={{ "panel-item": true, "panel-item-selected": !isSecretDisabled && item.id === selectedProductId(), "panel-item-disabled": isSecretDisabled }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isSecretDisabled) return
                                  const domainItem = safeDomains().find((d) => d.id === selectedDomainId())
                                  const productLineItem = safeProductLines().find((pl) => pl.id === selectedProductLineId())
                                  props.onProductConfirm({
                                    domain: domainItem,
                                    productLine: productLineItem,
                                    product: item,
                                  })
                                }}
                              >
                                <Show when={item.isTop}>
                                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ "flex-shrink": "0" }}>
                                    <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
                                  </svg>
                                </Show>
                                <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{item.name}</span>
                                <Show when={item.isSecret && !item.isProductMember}>
                                  <span class="secret-icon" style={{ "flex-shrink": "0" }}>
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                                      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                                    </svg>
                                  </span>
                                </Show>
                                <Show when={item.isEnd}>
                                  <span class="closed-label">已结项</span>
                                </Show>
                                <span class="pin-action" onClick={handleTopToggle} onPointerDown={(e) => e.stopPropagation()}>
                                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <Show when={item.isTop} fallback={
                                      <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
                                    }>
                                      <path d="M8 13L4 9h3V3h2v6h3L8 13z" fill="currentColor"/>
                                    </Show>
                                  </svg>
                                </span>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                  </Suspense>
                </Show>
              </div>
            </div>
          }>
            <ErrorContent onRetry={() => refetchDomains()} />
          </Show>
        </Show>
      </ErrorBoundary>
    </div>
  )
}