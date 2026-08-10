import component_usage from "./prompt/stastics/component_usage.md"
import a2ui_json_protocol_raw from "./prompt/stastics/a2ui_json_protocol.md"
import a2ui_schema from "./prompt/stastics/a2ui_schema.md"
import html5_schema from "./prompt/stastics/html5_schema.md"
import html_example from "./prompt/stastics/html_example.md"
import card_example from "./prompt/stastics/card_example.md"
import list_example from "./prompt/stastics/list_example.md"
import tabs_example from "./prompt/stastics/tabs_example.md"
import form_example from "./prompt/stastics/form_example.md"
import op_prompt from "./prompt/stastics/op_prompt.md"
import brand_guide from "./prompt/stastics/brand_guide.md"
import responsive_adaptive from "./prompt/stastics/responsive_adaptive.md"
import design_system from "./prompt/stastics/design_system.md"
import role from "./prompt/stastics/role.md"

import _RAW_PAGE_CREATE from "./prompt/proto_page_create.txt"
import _RAW_MODULE_MODIFY from "./prompt/proto_module_modify.txt"
import _RAW_PATTERN_BLOCK from "./prompt/proto_pattern_block.txt"
import _RAW_PATTERN_PAGE from "./prompt/proto_pattern_page.txt"
import _RAW_MODIFY from "./prompt/proto_modify.txt"
import _RAW_REPLANNER from "./prompt/proto_replanner.txt"

const _staticData: Record<string, string> = {
  component_usage,
  a2ui_schema,
  html5_schema,
  html_example,
  card_example,
  list_example,
  tabs_example,
  form_example,
  op_prompt,
  brand_guide,
  responsive_adaptive,
  design_system,  
  role,
}

export const staticData = _staticData

export function formatPrompt(template: string, overrides?: Record<string, string>): string {
  const merged = { ...staticData, ...overrides }
  return template.replace(/\{(\w+)\}/g, (match, key) => merged[key] ?? match)
}

_staticData.a2ui_json_protocol = formatPrompt(a2ui_json_protocol_raw)

export const PROMPT_PROTO_PAGE_CREATE = formatPrompt(_RAW_PAGE_CREATE)
export const PROMPT_PROTO_MODULE_MODIFY = formatPrompt(_RAW_MODULE_MODIFY)
export const PROMPT_PROTO_PATTERN_BLOCK = formatPrompt(_RAW_PATTERN_BLOCK)
export const PROMPT_PROTO_PATTERN_PAGE = formatPrompt(_RAW_PATTERN_PAGE)
export const PROMPT_PROTO_MODIFY = formatPrompt(_RAW_MODIFY)
export const PROMPT_PROTO_REPLANNER = formatPrompt(_RAW_REPLANNER)

export const RAW_TEMPLATES: Record<string, string> = {
  proto_page_create: _RAW_PAGE_CREATE,
  proto_module_modify: _RAW_MODULE_MODIFY,
  proto_pattern_block: _RAW_PATTERN_BLOCK,
  proto_pattern_page: _RAW_PATTERN_PAGE,
  proto_modify: _RAW_MODIFY,
  proto_replanner: _RAW_REPLANNER,
}
  
export * as Proto from "."
