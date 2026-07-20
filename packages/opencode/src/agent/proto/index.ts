import COMPONENTS_CATALOG from "./prompt/stastics/COMPONENTS_CATALOG.txt"
import component_usage from "./prompt/stastics/COMPONENTS_USAGE.txt"
import DESIGN_SYSTEM_PROMPT_DEFAULT from "./prompt/stastics/DESIGN_SYSTEM_PROMPT.txt"
import A2UI_JSON_PROTOCOL_RAW from "./prompt/stastics/A2UI_JSON_PROTOCOL.txt"
import A2UI_SCHEMA from "./prompt/stastics/A2UI_SCHEMA.txt"
import HTML5_SCHEMA from "./prompt/stastics/HTML5_SCHEMA.txt"
import HTML_EXAMPLE from "./prompt/stastics/HTML_EXAMPLE.txt"
import CARD_EXAMPLE from "./prompt/stastics/CARD_EXAMPLE.txt"
import LIST_EXAMPLE from "./prompt/stastics/LIST_EXAMPLE.txt"
import TABS_EXAMPLE from "./prompt/stastics/TABS_EXAMPLE.txt"
import FORM_EXAMPLE from "./prompt/stastics/FORM_EXAMPLE.txt"
import OP_PROMPT from "./prompt/stastics/OP_PROMPT.txt"

import _RAW_INTENT from "./prompt/proto_intent.txt"
import _RAW_INTENT_AUDIT from "./prompt/proto_intent_audit.txt"
import _RAW_MODULE_CREATE from "./prompt/proto_module_create.txt"
import _RAW_MODULE_MODIFY from "./prompt/proto_module_modify.txt"
import _RAW_PLANNER_CREATE from "./prompt/proto_planner_create.txt"
import _RAW_PLANNER_MODIFY from "./prompt/proto_planner_modify.txt"
import _RAW_TRIAGE from "./prompt/proto_triage.txt"
import _RAW_PATTERN_PAGE from "./prompt/proto_pattern_page.txt"
import _RAW_PATTERN_BLOCK from "./prompt/proto_pattern_block.txt"
import _RAW_INTENT_CONFIRM from "./prompt/proto_intent_confirm.txt"
import _RAW_WFRAMES from "./prompt/proto_wireframes.txt"
import _RAW_MODIFY from "./prompt/proto_modify.txt"
import _RAW_REPLANNER from "./prompt/proto_replanner.txt"

const _staticData: Record<string, string> = {
  COMPONENTS_CATALOG,
  component_usage,
  DESIGN_SYSTEM_PROMPT: DESIGN_SYSTEM_PROMPT_DEFAULT,
  A2UI_SCHEMA,
  HTML5_SCHEMA,
  HTML_EXAMPLE,
  CARD_EXAMPLE,
  LIST_EXAMPLE,
  TABS_EXAMPLE,
  FORM_EXAMPLE,
  OP_PROMPT,
}

export const staticData = _staticData

export function formatPrompt(template: string, overrides?: Record<string, string>): string {
  const merged = { ...staticData, ...overrides }
  return template.replace(/\{(\w+)\}/g, (match, key) => merged[key] ?? match)
}

_staticData.A2UI_JSON_PROTOCOL = formatPrompt(A2UI_JSON_PROTOCOL_RAW)

export const PROMPT_PROTO_INTENT = formatPrompt(_RAW_INTENT)
export const PROMPT_PROTO_INTENT_AUDIT = formatPrompt(_RAW_INTENT_AUDIT)
export const PROMPT_PROTO_MODULE_CREATE = formatPrompt(_RAW_MODULE_CREATE)
export const PROMPT_PROTO_MODULE_MODIFY = formatPrompt(_RAW_MODULE_MODIFY)
export const PROMPT_PROTO_PLANNER_CREATE = formatPrompt(_RAW_PLANNER_CREATE)
export const PROMPT_PROTO_PLANNER_MODIFY = formatPrompt(_RAW_PLANNER_MODIFY)
export const PROMPT_PROTO_TRIAGE = formatPrompt(_RAW_TRIAGE)
export const PROMPT_PROTO_PATTERN_PAGE = formatPrompt(_RAW_PATTERN_PAGE)
export const PROMPT_PROTO_PATTERN_BLOCK = formatPrompt(_RAW_PATTERN_BLOCK)
export const PROMPT_PROTO_INTENT_CONFIRM = formatPrompt(_RAW_INTENT_CONFIRM)
export const PROMPT_PROTO_WFRAMES = formatPrompt(_RAW_WFRAMES)
export const PROMPT_PROTO_MODIFY = formatPrompt(_RAW_MODIFY)
export const PROMPT_PROTO_REPLANNER = formatPrompt(_RAW_REPLANNER)

export const RAW_TEMPLATES: Record<string, string> = {
  proto_intent: _RAW_INTENT,
  proto_intent_audit: _RAW_INTENT_AUDIT,
  proto_module_create: _RAW_MODULE_CREATE,
  proto_module_modify: _RAW_MODULE_MODIFY,
  proto_planner_create: _RAW_PLANNER_CREATE,
  proto_planner_modify: _RAW_PLANNER_MODIFY,
  proto_triage: _RAW_TRIAGE,
  proto_pattern_page: _RAW_PATTERN_PAGE,
  proto_pattern_block: _RAW_PATTERN_BLOCK,
  proto_intent_confirm: _RAW_INTENT_CONFIRM,
  proto_wireframes: _RAW_WFRAMES,
  proto_modify: _RAW_MODIFY,
  proto_replanner: _RAW_REPLANNER,
}

export const DEFAULT_DESIGN_SYSTEM_PROMPT = DESIGN_SYSTEM_PROMPT_DEFAULT
export const DEFAULT_COMPONENTS_CATALOG = COMPONENTS_CATALOG

export * as Proto from "."
