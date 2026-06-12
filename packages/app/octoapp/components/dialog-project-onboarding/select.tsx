import { Select as Kobalte } from "@kobalte/core/select"
import { Show, createMemo, onCleanup, splitProps, type ComponentProps, type JSX } from "solid-js"
import { pipe, groupBy, entries, map } from "remeda"
import { Button, ButtonProps } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"

export type SelectProps<T> = Omit<ComponentProps<typeof Kobalte<T>>, "value" | "onSelect" | "children"> & {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  valueClass?: ComponentProps<"div">["class"]
  onSelect?: (value: T | undefined) => void
  onHighlight?: (value: T | undefined) => (() => void) | void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children?: (item: T | undefined) => JSX.Element
  triggerStyle?: JSX.CSSProperties
  triggerVariant?: "settings"
  triggerProps?: Record<string, string | number | boolean | undefined>
  emptyContent?: JSX.Element
}

export function Select<T>(props: SelectProps<T> & Omit<ButtonProps, "children">) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "placeholder",
    "options",
    "current",
    "value",
    "label",
    "groupBy",
    "valueClass",
    "onSelect",
    "onHighlight",
    "onOpenChange",
    "children",
    "triggerStyle",
    "triggerVariant",
    "triggerProps",
    "emptyContent",
  ])

  const state = {
    key: undefined as string | undefined,
    cleanup: undefined as (() => void) | void,
  }

  const stop = () => {
    state.cleanup?.()
    state.cleanup = undefined
    state.key = undefined
  }

  const keyFor = (item: T) => (local.value ? local.value(item) : (item as string))

  const move = (item: T | undefined) => {
    if (!local.onHighlight) return
    if (!item) {
      stop()
      return
    }

    const key = keyFor(item)
    if (state.key === key) return
    state.cleanup?.()
    state.cleanup = local.onHighlight(item)
    state.key = key
  }

  onCleanup(stop)

  const isEmpty = createMemo(() => local.options.length === 0)

  const grouped = createMemo(() => {
    if (local.options.length === 0 && local.emptyContent) {
      return [{ category: "", options: [{} as T] }]
    }
    const result = pipe(
      local.options,
      groupBy((x) => (local.groupBy ? local.groupBy(x) : "")),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
    return result
  })

  return (
    // @ts-ignore
    <Kobalte<T, { category: string; options: T[] }>
      {...others}
      data-component="select"
      data-trigger-style={local.triggerVariant}
      placement={local.triggerVariant === "settings" ? "bottom-end" : "bottom-start"}
      gutter={4}
      value={local.current}
      options={grouped()}
      optionValue={(x) => (local.value ? local.value(x) : (x as string))}
      optionTextValue={(x) => (local.label ? local.label(x) : (x as string))}
      optionGroupChildren="options"
      placeholder={local.placeholder}
      sectionComponent={(local) => (
        <Kobalte.Section data-slot="select-section">{local.section.rawValue.category}</Kobalte.Section>
      )}
      itemComponent={(itemProps) => {
        const isPinAction = (e: PointerEvent | MouseEvent) =>
          e.target instanceof Element && !!e.target.closest(".pin-action-icon")
        return (
          <Kobalte.Item
            {...itemProps}
            data-slot="select-select-item"
            classList={{
              ...local.classList,
              [local.class ?? ""]: !!local.class,
            }}
            onPointerDown={(e) => {
              if (isPinAction(e)) {
                e.stopPropagation()
                e.preventDefault()
                return
              }
              (itemProps as any).onPointerDown?.(e)
            }}
            onPointerUp={(e) => {
              if (isPinAction(e)) {
                e.stopPropagation()
                return
              }
              (itemProps as any).onPointerUp?.(e)
            }}
            onClick={(e) => {
              if (isPinAction(e)) {
                e.stopPropagation()
                return
              }
              (itemProps as any).onClick?.(e)
            }}
            onPointerEnter={() => move(itemProps.item.rawValue)}
            onPointerMove={() => move(itemProps.item.rawValue)}
            onFocus={() => move(itemProps.item.rawValue)}
          >
            <Kobalte.ItemLabel data-slot="select-select-item-label">
              {local.children
              ? local.children(itemProps.item.rawValue)
              : local.label
                ? local.label(itemProps.item.rawValue)
                : (itemProps.item.rawValue as string)}
          </Kobalte.ItemLabel>
            <Kobalte.ItemIndicator data-slot="select-select-item-indicator">
            <Icon name="check-small" size="small" />
          </Kobalte.ItemIndicator>
          </Kobalte.Item>
        )
      }}
      onChange={(v) => {
        local.onSelect?.(v ?? undefined)
        stop()
      }}
      onOpenChange={(open) => {
        local.onOpenChange?.(open)
        if (!open) stop()
      }}
    >
      <Kobalte.Trigger
        {...local.triggerProps}
        disabled={props.disabled}
        data-slot="select-select-trigger"
        as={Button}
        size={props.size}
        variant={props.variant}
        style={local.triggerStyle}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Kobalte.Value<T> data-slot="select-select-trigger-value" class={local.valueClass}>
          {(state) => {
            const selected = state.selectedOption() ?? local.current
            if (!selected) return local.placeholder || ""
            if (local.label) return local.label(selected)
            return selected as string
          }}
        </Kobalte.Value>
        <Kobalte.Icon data-slot="select-select-trigger-icon">
          <svg width="10" height="10" viewBox="0 0 10.0034 10" fill="none" style={{ "flex-shrink": "0" }}>
            <path d="M4.64832 7.6045L0.148315 3.10462C-0.0494385 2.90662 -0.0494385 2.59547 0.148315 2.39747C0.346558 2.19953 0.657593 2.19953 0.855347 2.39753L5.00183 6.54383L9.14783 2.39753C9.34607 2.19953 9.6571 2.19953 9.85486 2.39747C10.0531 2.59547 10.0531 2.90662 9.85486 3.10462L5.35535 7.6045C5.25769 7.7021 5.13953 7.75092 5.00183 7.75092C4.86365 7.75092 4.74597 7.7021 4.64832 7.6045Z" fill="rgb(119,119,119)" fill-rule="evenodd" />
          </svg>
        </Kobalte.Icon>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
          data-trigger-style={local.triggerVariant}
        >
          <Show when={!isEmpty()} fallback={local.emptyContent}>
            <Kobalte.Listbox data-slot="select-select-content-list" />
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}