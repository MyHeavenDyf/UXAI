import { Show, type JSX } from 'solid-js'
import type { ComponentItemConfig } from './types'

export function InputItem(props: {
  data: Extract<ComponentItemConfig, { type: 'input' }>['data']
  value: () => string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label class="cc-row">
      <span class="cc-label">{props.data.title}</span>
      <input
        type="text"
        class="cc-input-url"
        value={props.value() || props.data.default}
        placeholder={props.data.placeholder}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        autocomplete="off"
      />
    </label>
  )
}

export function SelectorItem(props: {
  data: Extract<ComponentItemConfig, { type: 'selector' }>['data']
  value: () => string
  onChange: (v: string) => void
}): JSX.Element {
  const current = () => props.value() || props.data.default
  return (
    <div class="cc-typ-row">
      <span class="cc-typ-label">{props.data.title}</span>
      <select
        class="cc-select-trigger"
        value={current()}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <Show when={!current()}>
          <option value="" disabled>Select...</option>
        </Show>
        {props.data.items.map((item) => (
          <option value={item.value} selected={current() === item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function renderComponentItem(
  item: ComponentItemConfig,
  value: () => string,
  onChange: (v: string) => void
): JSX.Element {
  if (item.type === 'input') {
    return <InputItem data={item.data} value={value} onChange={onChange} />
  }
  if (item.type === 'selector') {
    return <SelectorItem data={item.data} value={value} onChange={onChange} />
  }
  return <></>
}
