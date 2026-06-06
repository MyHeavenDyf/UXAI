import { ProjectProductSelect } from "./project-product-select"
import { Select } from "@opencode-ai/ui/select"
import { createStore } from "solid-js/store"
import { createEffect, createResource, Suspense, ErrorBoundary } from "solid-js"
import type { JSX } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "./project-product-select-api"
import { fetchVersions } from "./project-product-select-api"

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

  const [versionOptions] = createResource(() => store.product?.id ?? undefined, fetchVersions)

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
          triggerStyle={{
            width: "110px",
            height: "40px",
            "border-radius": "8px",
            "font-size": "14px",
            "line-height": "22px",
            border: "1px solid rgba(0,0,0,0.15)",
            background: "white",
            color: "#191919",
          }}
          triggerProps={{ class: "version-select-trigger" }}
        />
      )}>
        <Suspense fallback={
          <Select
            class="version-select-content"
            options={[]}
            placeholder="选择版本"
            triggerStyle={{
              width: "110px",
              height: "40px",
              "border-radius": "8px",
              "font-size": "14px",
              "line-height": "22px",
              border: "1px solid rgba(0,0,0,0.15)",
              background: "white",
              color: "#191919",
            }}
            triggerProps={{ class: "version-select-trigger" }}
          />
        }>
          <Select
            class="version-select-content"
            options={safeVersionOptions()}
            current={store.version}
            value={(o) => String(o.id)}
            label={(o) => o.name}
            placeholder="选择版本"
            triggerStyle={{
              width: "110px",
              height: "40px",
              "border-radius": "8px",
              "font-size": "14px",
              "line-height": "22px",
              border: "1px solid rgba(0,0,0,0.15)",
              background: "white",
              color: "#191919",
            }}
            triggerProps={{
              class: "version-select-trigger",
            }}
            onSelect={(o) => o && setStore("version", o)}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}