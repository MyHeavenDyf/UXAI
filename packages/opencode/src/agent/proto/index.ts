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

// 3D 场景 stastics（替代 load_components_docs 工具，agent 直接读静态目录生成 mesh/group）
import SCENE_CONFIG_SCHEMA from "./prompt/stastics/SCENE_CONFIG_SCHEMA.txt"
import MESH_GEOMETRY_CATALOG from "./prompt/stastics/MESH_GEOMETRY_CATALOG.txt"

// 3D 场景 agent prompts
import _RAW_SCENE_3D_INTENT from "./prompt/scene_3d/scene_3d_intent.txt"
import _RAW_SCENE_3D_INTENT_CONFIRM from "./prompt/scene_3d/scene_3d_intent_confirm.txt"
import _RAW_SCENE_3D_INTENT_AUDIT from "./prompt/scene_3d/scene_3d_intent_audit.txt"
import _RAW_SCENE_3D_PLANNER_CREATE from "./prompt/scene_3d/scene_3d_planner_create.txt"
import _RAW_SCENE_3D_PLANNER_MODIFY from "./prompt/scene_3d/scene_3d_planner_modify.txt"
import _RAW_SCENE_3D_MODULE_CREATE from "./prompt/scene_3d/scene_3d_module_create.txt"
import _RAW_SCENE_3D_MODULE_MODIFY from "./prompt/scene_3d/scene_3d_module_modify.txt"
import _RAW_SCENE_3D_TRIAGE from "./prompt/scene_3d/scene_3d_triage.txt"

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
  SCENE_CONFIG_SCHEMA,
  MESH_GEOMETRY_CATALOG,
}

export const staticData = _staticData

export function formatPrompt(template: string, overrides?: Record<string, string>): string {
  const merged = { ...staticData, ...overrides }
  return template.replace(/\{(\w+)\}/g, (match, key) => merged[key] ?? match)
}

_staticData.a2ui_json_protocol = formatPrompt(a2ui_json_protocol_raw)

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

// 3D 场景 agent prompts（formatPrompt 插值 {SCENE_CONFIG_SCHEMA} / {MESH_GEOMETRY_CATALOG}）
export const PROMPT_SCENE_3D_INTENT = formatPrompt(_RAW_SCENE_3D_INTENT)
export const PROMPT_SCENE_3D_INTENT_CONFIRM = formatPrompt(_RAW_SCENE_3D_INTENT_CONFIRM)
export const PROMPT_SCENE_3D_INTENT_AUDIT = formatPrompt(_RAW_SCENE_3D_INTENT_AUDIT)
export const PROMPT_SCENE_3D_PLANNER_CREATE = formatPrompt(_RAW_SCENE_3D_PLANNER_CREATE)
export const PROMPT_SCENE_3D_PLANNER_MODIFY = formatPrompt(_RAW_SCENE_3D_PLANNER_MODIFY)
export const PROMPT_SCENE_3D_MODULE_CREATE = formatPrompt(_RAW_SCENE_3D_MODULE_CREATE)
export const PROMPT_SCENE_3D_MODULE_MODIFY = formatPrompt(_RAW_SCENE_3D_MODULE_MODIFY)
export const PROMPT_SCENE_3D_TRIAGE = formatPrompt(_RAW_SCENE_3D_TRIAGE)

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
  scene_3d_intent: _RAW_SCENE_3D_INTENT,
  scene_3d_intent_confirm: _RAW_SCENE_3D_INTENT_CONFIRM,
  scene_3d_intent_audit: _RAW_SCENE_3D_INTENT_AUDIT,
  scene_3d_planner_create: _RAW_SCENE_3D_PLANNER_CREATE,
  scene_3d_planner_modify: _RAW_SCENE_3D_PLANNER_MODIFY,
  scene_3d_module_create: _RAW_SCENE_3D_MODULE_CREATE,
  scene_3d_module_modify: _RAW_SCENE_3D_MODULE_MODIFY,
  scene_3d_triage: _RAW_SCENE_3D_TRIAGE,
}

export const DEFAULT_DESIGN_SYSTEM = design_system
export const DEFAULT_COMPONENT_USAGE = component_usage
  
export * as Proto from "."
