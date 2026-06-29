import { ProjectProductSelect } from "./project-product-select"
import { Select } from "./select"
import { createStore } from "solid-js/store"
import { createEffect, createResource, createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

import { fetchVersions, topVersion, cancelTopVersion } from "@/network/pipelineRequest"
interface ProjectInfoDialogContentProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
  disabled?: boolean
  onSelectionChange?: (data: { domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void
}

export function ProjectInfoDialogContent(props: ProjectInfoDialogContentProps): JSX.Element {
  const [store, setStore] = createStore({
    domain: props.domain,
    productLine: props.productLine,
    product: props.product,
    version: props.version,
  })

  const [versionPopoverOpen, setVersionPopoverOpen] = createSignal(false)
  const [versionFetchProductId, setVersionFetchProductId] = createSignal<number | undefined>(undefined)
  let pinActionActive = false
  let versionCloseGuard = false

  const [versionOptions, { refetch: refetchVersions, mutate: mutateVersions }] = createResource(() =>  versionFetchProductId() ?? undefined, fetchVersions)

  const safeVersionOptions = () => {
    if (versionOptions.loading || versionOptions.error) return []
    return versionOptions() ?? []
  }

  createEffect(() => {
    const options = safeVersionOptions()
    if (!options.length) return
    setTimeout(() => { versionCloseGuard = false }, 0)
    const current = store.version
    if (!current) return
    if (!options.some((v) => v.id === current.id)) setStore("version", undefined)
  })

  createEffect(() => {
    props.onSelectionChange?.({ domain: store.domain, productLine: store.productLine, product: store.product, version: store.version })
  })

  const handleVersionTopToggle = (version: Version) => {
    pinActionActive = true
    const newIsTop = !version.isTop
    const fn = newIsTop ? topVersion : cancelTopVersion
    fn(version.baseTeam).then(() => {
      setStore("version", "isTop", newIsTop)
      mutateVersions(prev => {
        const updated = prev?.map(v => v.id === version.id ? { ...v, isTop: newIsTop } : v)
        return updated?.sort((a, b) => {
          if (a.isTop !== b.isTop) return a.isTop ? -1 : 1
          return a.sort - b.sort
        })
      })
      pinActionActive = false
    }).catch(() => {
      pinActionActive = false
    })
  }

  const versionItemContent = (o: Version | undefined) => {
    if (!o) return ""
    return (
      <>
        <Show when={o.isTop}>
          <svg class="top-mark" width="16" height="16" viewBox="0 0 1024 1024" fill="none" style={{ "flex-shrink": "0" }}>
            <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="#E53E3E" fill-rule="nonzero" />
          </svg>
        </Show>
        <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{o.name}</span>
        <Show when={o.isEnd}>
          <span class="closed-label">已结项</span>
        </Show>
        <span
          class="pin-action-icon"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault() }}
          onPointerUp={(e) => { e.stopPropagation(); handleVersionTopToggle(o) }}
        >
          <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
            <Show when={o.isTop} fallback={
              <path d="M477.366 269.291C495.926 252.95 523.062 251.67 542.987 265.494L547.808 269.249L877.653 553.452C889.216 563.564 896 578.156 896 593.516C896 621.121 875.136 643.863 848.213 646.593L842.666 646.849L684.683 646.849L684.683 832.001C684.683 867.329 656.011 896.007 620.683 896.007L401.334 896.007C368.097 896.007 340.747 870.444 337.633 837.974L337.334 832.001L337.334 646.849L181.333 646.849C167.936 646.849 155.264 641.814 145.493 632.812L141.226 628.759C123.05 608.108 123.946 577.388 142.079 557.548L145.919 553.495L477.366 269.291ZM512.566 323.477L209.493 582.848L369.334 582.848C385.547 582.848 398.945 594.88 401.078 610.496L401.334 614.848L401.334 832L620.683 832L620.683 614.848C620.683 598.635 632.715 585.28 648.331 583.147L652.683 582.848L814.08 582.848L512.566 323.477L512.566 323.477ZM864 128C881.673 128 896 142.327 896 160C896 176.2 883.886 189.589 868.267 191.708L864 192L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L864 128L864 128Z" fill="currentColor" fill-rule="nonzero" />
            }>
              <path d="M919.067 103.374C930.374 114.28 931.919 131.498 923.506 144.123L919.884 148.621L687.444 389.574L877.654 553.451C889.217 563.563 896.001 578.155 896.001 593.515C896.001 618.82 878.469 640.038 854.81 645.502L848.214 646.593L842.667 646.849L684.684 646.849L684.684 832.001C684.684 864.806 659.962 891.876 628.144 895.576L620.684 896.007L401.335 896.007C370.654 896.007 344.991 874.225 338.774 845.336L337.633 837.974L337.334 832.001L337.3 752.583L151.884 944.857C139.615 957.577 119.357 957.943 106.637 945.674C95.3301 934.768 93.7851 917.55 102.198 904.925L105.82 900.427L873.82 104.193C886.089 91.4729 906.347 91.1069 919.067 103.376L919.067 103.374ZM642.964 435.654L401.3 686.214L401.334 832L620.683 832L620.683 614.848C620.683 600.661 629.895 588.663 642.66 584.456L648.332 583.146L652.684 582.847L814.081 582.847L642.965 435.653L642.964 435.654ZM536.1 261.445L542.987 265.494L547.808 269.249L590.719 306.23L546.175 352.374L512.565 323.478L209.492 582.849L323.903 582.838L262.207 646.838L181.332 646.849C170.614 646.849 160.36 643.627 151.685 637.729L145.492 632.812L141.225 628.759C124.701 609.986 123.94 582.891 137.562 563.213L142.079 557.548L145.919 553.495L477.365 269.292C493.863 254.766 517.137 252.141 536.099 261.446L536.1 261.445ZM762.624 127.99L700.864 191.99L160 192C142.327 192 128 177.673 128 160C128 143.8 140.039 130.411 155.658 128.292L160 128L762.624 127.99L762.624 127.99Z" fill="currentColor" fill-rule="nonzero" />
            </Show>
          </svg>
        </span>
      </>
    )
  }

  const emptyVersionContent = (
    <div style={{ padding: "12px 16px", "text-align": "center", color: "rgba(0,0,0,0.4)", "font-size": "13px" }}>
      无数据
    </div>
  )

  const versionEmptyContent = () =>
    versionOptions.loading
      ? <div style={{ padding: "12px 16px", "text-align": "center", color: "rgba(0,0,0,0.4)", "font-size": "13px" }}>加载中...</div>
      : emptyVersionContent

  const versionSelectTriggerStyle = {
    width: "110px",
    height: "40px",
    "border-radius": "8px",
    "font-size": "14px",
    "line-height": "22px",
    border: "1px solid rgba(0,0,0,0.15)",
    background: props.disabled ? "rgba(0,0,0,0.04)" : "white",
    color: props.disabled ? "rgba(0,0,0,0.3)" : "#191919",
    cursor: props.disabled ? "not-allowed" : "pointer",
  }

  return (
    <div style={{ width: "100%", height: "40px", display: "flex", gap: "4px", "align-items": "center" }}>
      <ProjectProductSelect
        domain={store.domain}
        productLine={store.productLine}
        product={store.product}
        disabled={props.disabled}
        onProductConfirm={(data) => {
          setStore("domain", data.domain)
          setStore("productLine", data.productLine)
          setStore("product", data.product)
          setStore("version", undefined)
          setVersionFetchProductId(undefined)
        }}
      />
      <Select
        class="version-select-content"
        options={safeVersionOptions()}
        current={store.version}
        value={(o) => String(o.id)}
        label={(o) => o.name}
        children={versionItemContent}
        placeholder="选择版本"
        emptyContent={versionEmptyContent()}
        disabled={props.disabled}
        triggerStyle={versionSelectTriggerStyle}
        triggerProps={{ class: "version-select-trigger" }}
        open={versionPopoverOpen()}
        onOpenChange={(open) => {
          if (pinActionActive && !open) return
          if (props.disabled) return
          if (!open && (versionCloseGuard || versionOptions.loading)) return
          if (open) {
            versionCloseGuard = true
            setVersionFetchProductId(store.product?.id)
          }
          setVersionPopoverOpen(open)
        }}
        onSelect={(o) => {
          if (pinActionActive) return
          o && setStore("version", o)
        }}
      />
    </div>
  )
}