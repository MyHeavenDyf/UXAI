import type { ManualEditKind } from "../../edit-mode/source-patches"

export type { ManualEditKind }

export type SelectionKind = "component" | "native"

export type ModelEditElement = {
  dataOdId: string
  tagName: string
  className: string
  attributes: Record<string, string>
  styles: Record<string, string>
  outerHTML: string
  rect: { x: number; y: number; width: number; height: number }
  text: string
  selector: string
  htmlHint: string
  isLayoutContainer: boolean
  elementKind: ManualEditKind
  selectionKind: SelectionKind
  componentType?: string
  htmlType?: string
}

export type InputItemData = {
  title: string
  default: string
  placeholder: string
}

export type SelectorItemData = {
  title: string
  items: { value: string; label: string }[]
  default: string
}

export type ComponentItemConfig =
  | { type: "input"; key: string; data: InputItemData }
  | { type: "selector"; key: string; data: SelectorItemData }

export type NativeItemConfig = {
  type: string
  key: string
}

export type ConfigItem = ComponentItemConfig | NativeItemConfig

export type ConfigGroup = {
  title?: string
  items: ConfigItem[]
}

export type ComponentTypeConfig = {
  title: string
  info?: (dom: ModelEditElement) => string
  config: ConfigGroup[]
  data: (dom: ModelEditElement) => Record<string, string>
}

export type HtmlTypeConfig = {
  config: (defaultConfig: ConfigGroup[]) => ConfigGroup[]
  data: (defaultData: Record<string, string>, dom: ModelEditElement) => Record<string, string>
}

export type SaveCallbackArgs = {
  type: string
  prev: Record<string, string>
  current: Record<string, string>
  dom: ModelEditElement
  filePath: string
}

export type DeleteCallbackArgs = {
  type: string
  dom: ModelEditElement
  filePath: string
}

export type ModelEditConfig = {
  componentFlag?: string
  componentConfig?: Record<string, ComponentTypeConfig>
  htmlFlag?: string
  htmlConfig?: Record<string, HtmlTypeConfig>
  saveCallback: (args: SaveCallbackArgs) => string
  deleteCallback: (args: DeleteCallbackArgs) => string
  promptCallback?: (filePath: string, selector: string) => string
}
