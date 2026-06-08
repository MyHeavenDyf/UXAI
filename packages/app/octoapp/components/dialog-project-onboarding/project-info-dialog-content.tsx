import { ProjectProductSelect } from "./project-product-select"
import { Select } from "@opencode-ai/ui/select"
import { createStore } from "solid-js/store"
import { createEffect, createResource, createSignal, Suspense, ErrorBoundary, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "./project-product-select-api"
import { fetchVersions, topVersion, cancelTopVersion } from "./project-product-select-api"

interface ProjectInfoDialogContentProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
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
  let pinActionActive = false

  const [versionOptions, { refetch: refetchVersions, mutate: mutateVersions }] = createResource(() => store.product?.id ?? undefined, fetchVersions)

  createEffect(() => {
    const options = versionOptions()
    if (!options?.length) return
    const current = store.version
    const match = current && options.some((v) => v.id === current.id)
    setStore("version", match ? current : options[0])
  })

  createEffect(() => {
    props.onSelectionChange?.({ domain: store.domain, productLine: store.productLine, product: store.product, version: store.version })
  })

  const safeVersionOptions = () => {
    try {
      return versionOptions() ?? []
    } catch {
      return []
    }
  }

  const handleVersionTopToggle = (version: Version) => {
    pinActionActive = true
    const newIsTop = !version.isTop
    const fn = newIsTop ? topVersion : cancelTopVersion
    fn(version.baseTeam).then(() => {
      setStore("version", "isTop", newIsTop)
      mutateVersions(prev => prev?.map(v => v.id === version.id ? { ...v, isTop: newIsTop } : v))
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ "flex-shrink": "0" }}>
            <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
          </svg>
        </Show>
        <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{o.name}</span>
        <Show when={o.isEnd}>
          <span class="closed-label">已结项</span>
        </Show>
        <span
          class="pin-action-icon"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault() }}
          onPointerUp={(e) => { e.stopPropagation(); handleVersionTopToggle(o) }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <Show when={o.isTop} fallback={
              <path d="M8 3L4 7h3v6h2V7h3L8 3z" fill="currentColor"/>
            }>
              <path d="M8 13L4 9h3V3h2v6h3L8 13z" fill="currentColor"/>
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

  const versionSelectTriggerStyle = {
    width: "110px",
    height: "40px",
    "border-radius": "8px",
    "font-size": "14px",
    "line-height": "22px",
    border: "1px solid rgba(0,0,0,0.15)",
    background: "white",
    color: "#191919",
  }

  return (
    <div style={{ width: "100%", height: "40px", display: "flex", gap: "4px", "align-items": "center" }}>
      <ProjectProductSelect
        domain={store.domain}
        productLine={store.productLine}
        product={store.product}
        onProductConfirm={(data) => {
          setStore("domain", data.domain)
          setStore("productLine", data.productLine)
          setStore("product", data.product)
        }}
      />
      <ErrorBoundary fallback={() => (
        <Select
          class="version-select-content"
          options={[]}
          placeholder="选择版本"
          emptyContent={emptyVersionContent}
          triggerStyle={versionSelectTriggerStyle}
          triggerProps={{ class: "version-select-trigger" }}
        />
      )}>
        <Suspense fallback={
          <Select
            class="version-select-content"
            options={[]}
            placeholder="选择版本"
            emptyContent={emptyVersionContent}
            triggerStyle={versionSelectTriggerStyle}
            triggerProps={{ class: "version-select-trigger" }}
          />
        }>
          <Select
            class="version-select-content"
            options={safeVersionOptions()}
            current={store.version}
            value={(o) => String(o.id)}
            label={(o) => o.name}
            children={versionItemContent}
            placeholder="选择版本"
            emptyContent={emptyVersionContent}
            triggerStyle={versionSelectTriggerStyle}
            triggerProps={{ class: "version-select-trigger" }}
            open={versionPopoverOpen()}
            onOpenChange={(open) => {
              if (pinActionActive && !open) return
              setVersionPopoverOpen(open)
            }}
            onSelect={(o) => {
              if (pinActionActive) return
              o && setStore("version", o)
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}