import type { JSX } from 'solid-js'
import type { ConfigGroup, ConfigItem, NativeItemConfig, ComponentItemConfig, ModelEditElement, ManualEditKind } from './types'
import { NATIVE_ITEMS, type NativeItemDef } from './native-items'
import { renderComponentItem } from './component-items'

export { NATIVE_ITEMS }
export type { NativeItemDef }

const TYPOGRAPHY_GROUP: ConfigGroup = {
  title: '文字',
  items: [
    { type: 'fontFamily', key: 'od_fontFamily' },
    { type: 'fontWeight', key: 'od_fontWeight' },
    { type: 'fontSize', key: 'od_fontSize' },
    { type: 'color', key: 'od_color' },
    { type: 'textAlign', key: 'od_textAlign' },
    { type: 'lineHeight', key: 'od_lineHeight' },
    { type: 'letterSpacing', key: 'od_letterSpacing' },
    { type: 'verticalAlign', key: 'od_verticalAlign' },
  ],
}

const SIZE_GROUP: ConfigGroup = {
  items: [
    { type: 'sizeGroup', key: 'od_size' },
  ],
}

const LAYOUT_GROUP: ConfigGroup = {
  items: [
    { type: 'layoutGroup', key: 'od_layout' },
  ],
}

const APPEARANCE_GROUP: ConfigGroup = {
  items: [
    { type: 'appearanceGroup', key: 'od_appearance' },
  ],
}

const PADDING_GROUP: ConfigGroup = {
  items: [
    { type: 'paddingGroup', key: 'od_padding' },
  ],
}

const MARGIN_GROUP: ConfigGroup = {
  items: [
    { type: 'marginGroup', key: 'od_margin' },
  ],
}

const BORDER_GROUP: ConfigGroup = {
  items: [
    { type: 'borderGroup', key: 'od_border' },
  ],
}

const RADIUS_GROUP: ConfigGroup = {
  items: [
    { type: 'borderRadius', key: 'od_borderRadius' },
  ],
}

const EFFECTS_GROUP: ConfigGroup = {
  items: [
    { type: 'effectsGroup', key: 'od_effects' },
  ],
}

const BG_IMAGE_GROUP: ConfigGroup = {
  items: [
    { type: 'bgImageGroup', key: 'od_bgImage' },
  ],
}

const TEXT_GROUP: ConfigGroup = {
  title: '文本',
  items: [
    { type: 'textContent', key: 'od_textContent' },
  ],
}

const LINK_GROUP: ConfigGroup = {
  title: '链接',
  items: [
    { type: 'href', key: 'od_href' },
  ],
}

export function getDefaultNativeConfig(kind: ManualEditKind, isLayoutContainer?: boolean): ConfigGroup[] {
  switch (kind) {
    case 'text':
      return [TYPOGRAPHY_GROUP]
    case 'link':
      return [LINK_GROUP, TYPOGRAPHY_GROUP]
    case 'image':
      return [SIZE_GROUP, APPEARANCE_GROUP, PADDING_GROUP, MARGIN_GROUP, BORDER_GROUP, EFFECTS_GROUP]
    case 'container':
      return [
        ...(isLayoutContainer ? [LAYOUT_GROUP] : []),
        SIZE_GROUP, APPEARANCE_GROUP, PADDING_GROUP, MARGIN_GROUP, BORDER_GROUP, EFFECTS_GROUP, BG_IMAGE_GROUP,
      ]
    case 'mixed':
      return [TEXT_GROUP, TYPOGRAPHY_GROUP]
    case 'token':
      return [TYPOGRAPHY_GROUP, PADDING_GROUP, MARGIN_GROUP, APPEARANCE_GROUP, BORDER_GROUP, EFFECTS_GROUP]
    default:
      return [TYPOGRAPHY_GROUP]
  }
}

export function readNativeDefaults(
  kind: ManualEditKind,
  element: ModelEditElement
): Record<string, string> {
  const groups = getDefaultNativeConfig(kind, element.isLayoutContainer)
  const result: Record<string, string> = {}
  for (const group of groups) {
    for (const item of group.items) {
      if (!('data' in item)) {
        const def = NATIVE_ITEMS[item.type]
        if (def) {
          result[item.key] = def.readValue(element)
        }
      }
    }
  }
  return result
}

function isComponentItem(item: ConfigItem): item is ComponentItemConfig {
  return item.type === 'input' || item.type === 'selector'
}

export function renderConfigItem(
  item: ConfigItem,
  value: () => string,
  onChange: (v: string) => void
): JSX.Element {
  if (isComponentItem(item)) {
    return renderComponentItem(item, value, onChange)
  }
  const def = NATIVE_ITEMS[item.type]
  if (!def) {
    return <div class="cc-row"><span class="cc-label">Unknown: {item.type}</span></div>
  }
  return def.render({ value, onChange })
}

export function checkKeyConflicts(groups: ConfigGroup[]): string[] {
  const seen = new Map<string, string>()
  const conflicts: string[] = []
  for (const group of groups) {
    for (const item of group.items) {
      if (seen.has(item.key)) {
        conflicts.push(`Duplicate key "${item.key}" (types: ${seen.get(item.key)}, ${item.type})`)
      } else {
        seen.set(item.key, item.type)
      }
    }
  }
  return conflicts
}
