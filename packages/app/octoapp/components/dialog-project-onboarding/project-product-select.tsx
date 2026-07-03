import { Popover } from "@opencode-ai/ui/popover"
import { ProjectProductSelectPanel } from "./project-product-select-panel"
import type { Domain, ProductLine, Product } from "@/network/types"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"

interface ProjectProductSelectProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  disabled?: boolean
  onProductConfirm?: (data: { domain?: Domain; productLine?: ProductLine; product?: Product }) => void
}

export function ProjectProductSelect(props: ProjectProductSelectProps): JSX.Element {
  const [popoverOpen, setPopoverOpen] = createSignal(false)

  const selectedLabel = () => {
    const parts = []
    if (props.domain && props.domain.name) parts.push(props.domain.name)
    if (props.productLine && props.productLine.name) parts.push(props.productLine.name)
    if (props.product && props.product.name) parts.push(props.product.name)
    return parts.length ? parts.join("/") : "选择产品"
  }

  return (
    <Popover
      open={popoverOpen()}
      onOpenChange={(open) => { if (!props.disabled) setPopoverOpen(open) }}
      trigger={
        <>
          <span style={{ flex: "1", "text-align": "left", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{selectedLabel()}</span>
          <svg width="10" height="10" viewBox="0 0 10.0034 10" fill="none" style={{ "flex-shrink": "0" }}>
            <path d="M4.64832 7.6045L0.148315 3.10462C-0.0494385 2.90662 -0.0494385 2.59547 0.148315 2.39747C0.346558 2.19953 0.657593 2.19953 0.855347 2.39753L5.00183 6.54383L9.14783 2.39753C9.34607 2.19953 9.6571 2.19953 9.85486 2.39747C10.0531 2.59547 10.0531 2.90662 9.85486 3.10462L5.35535 7.6045C5.25769 7.7021 5.13953 7.75092 5.00183 7.75092C4.86365 7.75092 4.74597 7.7021 4.64832 7.6045Z" fill="rgb(119,119,119)" fill-rule="evenodd" />
          </svg>
        </>
      }
      triggerAs="button"
      triggerProps={{
        style: {
          width: "220px",
          height: "40px",
          "font-size": "14px",
          "line-height": "22px",
          color: props.disabled ? "rgba(0,0,0,0.3)" : "#191919",
          background: props.disabled ? "rgba(0,0,0,0.04)" : "white",
          border: "1px solid rgba(0,0,0,0.15)",
          "border-radius": "8px",
          padding: "0 12px",
          cursor: props.disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          "justify-content": "flex-start",
          "align-items": "center",
          gap: "4px",
        },
        ...(props.disabled ? { disabled: true } : {}),
      }}
      placement="bottom-start"
      style={{
        width: "522px",
        "max-width": "522px",
        "max-height": "400px",
        "z-index": "60",
      }}
    >
      <ProjectProductSelectPanel
        domain={props.domain}
        productLine={props.productLine}
        product={props.product}
        onProductConfirm={(data) => {
          props.onProductConfirm?.(data)
          setPopoverOpen(false)
        }}
      />
    </Popover>
  )
}