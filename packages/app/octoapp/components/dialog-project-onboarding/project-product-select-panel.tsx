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
        .panel-item-list { max-height: 240px; overflow-y: auto; scrollbar-gutter: stable; }
        .panel-item-list::-webkit-scrollbar { width: 8px; }
        .panel-item-list::-webkit-scrollbar-thumb { background: #dfdfdf; border: 1px solid transparent; border-radius: 4px; }
        .panel-item-list::-webkit-scrollbar-thumb:hover { background: #aeaeae }
        .panel-item { font-size: 14px; line-height: 22px; padding: 4px 8px; cursor: pointer; border-radius: 6px; margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
        .panel-item-selected { background: rgba(37, 99, 235, 0.08); color: #2563EB; }
        .panel-item:not(.panel-item-selected):hover { background: #f3f3f3; }
        .panel-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
        .panel-item .pin-action { visibility: hidden; margin-left: auto; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; fill: #191919; }
        .panel-item:hover .pin-action { visibility: visible; }
        .closed-label { font-size: 12px; color: rgba(0,0,0,0.45); background: rgba(0,0,0,0.04); padding: 0 4px; border-radius: 2px; line-height: 18px; flex-shrink: 0; }
        .panel-item-disabled { opacity: 0.5; cursor: not-allowed; }
        .panel-item-selected .pin-action { color: #191919; }
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
              <div class="panel-item-list" style={{ "max-height": "280px", "margin-right": "-8px" }}>
                <div style={{ "font-size": "14px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 0 0 8px" }}>搜索结果</div>
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
                          <svg class="top-mark" width="16" height="16" viewBox="0 0 1024 1024" fill="none" style={{ "flex-shrink": "0" }}>
                            <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="#E53E3E" fill-rule="nonzero" />
                          </svg>
                        </Show>
                        <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{result.name}</span>
                        <Show when={result.isSecret && !result.isProductMember}>
                          <span class="secret-icon" style={{ "flex-shrink": "0" }}>
                            <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                              <path d="M512.013 85.34C626.553 85.34 719.416 178.187 719.416 292.743L719.403 394.652L725.334 394.661C792.787 394.661 848.094 446.902 852.983 513.112L853.334 522.661L853.334 810.661C853.334 881.356 796.012 938.661 725.334 938.661L298.667 938.661C227.989 938.661 170.667 881.356 170.667 810.661L170.667 522.661C170.667 451.996 228.002 394.661 298.667 394.661L304.555 394.652L304.568 292.743C304.568 182.13 391.144 91.769 500.241 85.669L512.013 85.34ZM725.333 458.66L298.666 458.66C263.347 458.66 234.666 487.341 234.666 522.66L234.666 810.66C234.666 846.005 263.33 874.66 298.666 874.66L725.333 874.66C760.669 874.66 789.333 846.005 789.333 810.66L789.333 522.66C789.333 487.341 760.652 458.66 725.333 458.66L725.333 458.66ZM512 554.869C528.2 554.869 541.589 566.908 543.708 582.527L544 586.869L544.057 672.042C556.976 681.778 565.333 697.249 565.333 714.66C565.333 744.1 541.44 767.993 512 767.993C482.56 767.993 458.667 744.1 458.667 714.66C458.667 697.24 467.033 681.762 479.963 672.027L480 586.869C480 569.196 494.327 554.869 512 554.869L512 554.869ZM512.013 149.34C432.78 149.34 368.568 213.53 368.568 292.743L368.555 394.635L655.403 394.635L655.416 292.743C655.416 216.176 595.419 153.637 519.881 149.552L512.013 149.34Z" fill="currentColor" fill-rule="nonzero" />
                            </svg>
                          </span>
                        </Show>
                        <Show when={result.isEnd}>
                          <span class="closed-label">已结项</span>
                        </Show>
                        <span class="pin-action" onClick={handleTopToggle} onPointerDown={(e) => e.stopPropagation()}>
                          <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                            <Show when={result.isTop} fallback={
                              <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="currentColor" fill-rule="nonzero" />
                            }>
                              <path d="M919.067 103.374C930.374 114.28 931.919 131.498 923.506 144.123L919.884 148.621L687.444 389.574L877.654 553.451C889.217 563.563 896.001 578.155 896.001 593.515C896.001 618.82 878.469 640.038 854.81 645.502L848.214 646.593L842.667 646.849L684.684 646.849L684.684 832.001C684.684 864.806 659.962 891.876 628.144 895.576L620.684 896.007L401.335 896.007C370.654 896.007 344.991 874.225 338.774 845.336L337.633 837.974L337.334 832.001L337.3 752.583L151.884 944.857C139.615 957.577 119.357 957.943 106.637 945.674C95.3301 934.768 93.7851 917.55 102.198 904.925L105.82 900.427L873.82 104.193C886.089 91.4729 906.347 91.1069 919.067 103.376L919.067 103.374ZM642.964 435.654L401.3 686.214L401.334 832L620.683 832L620.683 614.848C620.683 600.661 629.895 588.663 642.66 584.456L648.332 583.146L652.684 582.847L814.081 582.847L642.965 435.653L642.964 435.654ZM536.1 261.445L542.987 265.494L547.808 269.249L590.719 306.23L546.175 352.374L512.565 323.478L209.492 582.849L323.903 582.838L262.207 646.838L181.332 646.849C170.614 646.849 160.36 643.627 151.685 637.729L145.492 632.812L141.225 628.759C124.701 609.986 123.94 582.891 137.562 563.213L142.079 557.548L145.919 553.495L477.365 269.292C493.863 254.766 517.137 252.141 536.099 261.446L536.1 261.445ZM762.624 127.99L700.864 191.99L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L762.624 127.99L762.624 127.99Z" fill="currentColor" fill-rule="nonzero" />
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
              <div style={{ width: "calc(33.33% - 3px)", "border-right": "1px solid rgba(0,0,0,0.08)", }}>
                <div style={{ "font-size": "14px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>领域</div>
                <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                  <Show when={safeDomains().length > 0} fallback={<div style={emptyHintStyle}>暂无领域数据</div>}>
                    <div class="panel-item-list">
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
                            <span class="panel-label">{item.name}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Suspense>
              </div>
              <div style={{ width: "calc(33.33% + 5px)", "border-right": "1px solid rgba(0,0,0,0.08)", padding: "0 0 0 8px" }}>
                <div style={{ "font-size": "14px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品线</div>
                <Show when={selectedDomainId()} fallback={<div style={emptyHintStyle}>请先选择领域</div>}>
                  <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                    <Show when={safeProductLines().length > 0} fallback={<div style={emptyHintStyle}>暂无产品线数据</div>}>
                      <div class="panel-item-list">
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
                              <span class="panel-label">{item.name}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Suspense>
                </Show>
              </div>
              <div style={{ width: "calc(33.33% - 4px)", padding: "0 0 0 8px", }}>
                <div style={{ "font-size": "14px", "font-weight": 600, color: "#191919", "margin-bottom": "8px", padding: "0 8px" }}>产品</div>
                <Show when={selectedProductLineId()} fallback={<div style={emptyHintStyle}>请先选择产品线</div>}>
                  <Suspense fallback={<div style={emptyHintStyle}>加载中...</div>}>
                    <Show when={safeAllProducts().length > 0 || filteredProducts().length > 0} fallback={<div style={emptyHintStyle}>暂无产品数据</div>}>
                      <div class="panel-item-list" style={{ "margin-right": "-8px", }}>
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
                                  <svg class="top-mark" width="16" height="16" viewBox="0 0 1024 1024" fill="none" style={{ "flex-shrink": "0" }}>
                                    <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="#E53E3E" fill-rule="nonzero" />
                                  </svg>
                                </Show>
                                <span class="panel-label">
                                  {item.name}
                                </span>
                                <Show when={item.isSecret && !item.isProductMember}>
                                  <span class="secret-icon" style={{ "flex-shrink": "0" }}>
                                    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                                      <path d="M512.013 85.34C626.553 85.34 719.416 178.187 719.416 292.743L719.403 394.652L725.334 394.661C792.787 394.661 848.094 446.902 852.983 513.112L853.334 522.661L853.334 810.661C853.334 881.356 796.012 938.661 725.334 938.661L298.667 938.661C227.989 938.661 170.667 881.356 170.667 810.661L170.667 522.661C170.667 451.996 228.002 394.661 298.667 394.661L304.555 394.652L304.568 292.743C304.568 182.13 391.144 91.769 500.241 85.669L512.013 85.34ZM725.333 458.66L298.666 458.66C263.347 458.66 234.666 487.341 234.666 522.66L234.666 810.66C234.666 846.005 263.33 874.66 298.666 874.66L725.333 874.66C760.669 874.66 789.333 846.005 789.333 810.66L789.333 522.66C789.333 487.341 760.652 458.66 725.333 458.66L725.333 458.66ZM512 554.869C528.2 554.869 541.589 566.908 543.708 582.527L544 586.869L544.057 672.042C556.976 681.778 565.333 697.249 565.333 714.66C565.333 744.1 541.44 767.993 512 767.993C482.56 767.993 458.667 744.1 458.667 714.66C458.667 697.24 467.033 681.762 479.963 672.027L480 586.869C480 569.196 494.327 554.869 512 554.869L512 554.869ZM512.013 149.34C432.78 149.34 368.568 213.53 368.568 292.743L368.555 394.635L655.403 394.635L655.416 292.743C655.416 216.176 595.419 153.637 519.881 149.552L512.013 149.34Z" fill="currentColor" fill-rule="nonzero" />
                                    </svg>
                                  </span>
                                </Show>
                                <Show when={item.isEnd}>
                                  <span class="closed-label">已结项</span>
                                </Show>
                                <span class="pin-action" onClick={handleTopToggle} onPointerDown={(e) => e.stopPropagation()}>
                                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                                    <Show when={item.isTop} fallback={
                                      <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="currentColor" fill-rule="nonzero" />
                                    }>
                                      <path d="M919.067 103.374C930.374 114.28 931.919 131.498 923.506 144.123L919.884 148.621L687.444 389.574L877.654 553.451C889.217 563.563 896.001 578.155 896.001 593.515C896.001 618.82 878.469 640.038 854.81 645.502L848.214 646.593L842.667 646.849L684.684 646.849L684.684 832.001C684.684 864.806 659.962 891.876 628.144 895.576L620.684 896.007L401.335 896.007C370.654 896.007 344.991 874.225 338.774 845.336L337.633 837.974L337.334 832.001L337.3 752.583L151.884 944.857C139.615 957.577 119.357 957.943 106.637 945.674C95.3301 934.768 93.7851 917.55 102.198 904.925L105.82 900.427L873.82 104.193C886.089 91.4729 906.347 91.1069 919.067 103.376L919.067 103.374ZM642.964 435.654L401.3 686.214L401.334 832L620.683 832L620.683 614.848C620.683 600.661 629.895 588.663 642.66 584.456L648.332 583.146L652.684 582.847L814.081 582.847L642.965 435.653L642.964 435.654ZM536.1 261.445L542.987 265.494L547.808 269.249L590.719 306.23L546.175 352.374L512.565 323.478L209.492 582.849L323.903 582.838L262.207 646.838L181.332 646.849C170.614 646.849 160.36 643.627 151.685 637.729L145.492 632.812L141.225 628.759C124.701 609.986 123.94 582.891 137.562 563.213L142.079 557.548L145.919 553.495L477.365 269.292C493.863 254.766 517.137 252.141 536.099 261.446L536.1 261.445ZM762.624 127.99L700.864 191.99L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L762.624 127.99L762.624 127.99Z" fill="currentColor" fill-rule="nonzero" />
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