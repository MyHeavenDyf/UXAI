import COMPONENTS_CATALOG from "./prompt/stastics/COMPONENTS_CATALOG.txt"
import COMPONENTS_USAGE from "./prompt/stastics/COMPONENTS_USAGE.txt"
import DESIGN_SYSTEM_PROMPT from "./prompt/stastics/DESIGN_SYSTEM_PROMPT.txt"
import A2UI_JSON_PROTOCOL_RAW from "./prompt/stastics/A2UI_JSON_PROTOCOL.txt"
import A2UI_SCHEMA from "./prompt/stastics/A2UI_SCHEMA.txt"
import HTML5_SCHEMA from "./prompt/stastics/HTML5_SCHEMA.txt"
import HTML_EXAMPLE from "./prompt/stastics/HTML_EXAMPLE.txt"
import CARD_EXAMPLE from "./prompt/stastics/CARD_EXAMPLE.txt"
import LIST_EXAMPLE from "./prompt/stastics/LIST_EXAMPLE.txt"
import TABS_EXAMPLE from "./prompt/stastics/TABS_EXAMPLE.txt"
import FORM_EXAMPLE from "./prompt/stastics/FORM_EXAMPLE.txt"

// 3D 场景 stastics（替代 load_components_docs 工具，agent 直接读静态目录生成 mesh/group）
import SCENE_CONFIG_SCHEMA from "./prompt/stastics/SCENE_CONFIG_SCHEMA.txt"
import MESH_GEOMETRY_CATALOG from "./prompt/stastics/MESH_GEOMETRY_CATALOG.txt"

import _PROMPT_PROTO_INTENT from "./prompt/proto_intent.txt"
import _PROMPT_PROTO_INTENT_AUDIT from "./prompt/proto_intent_audit.txt"
import _PROMPT_PROTO_MODULE_CREATE from "./prompt/proto_module_create.txt"
import _PROMPT_PROTO_MODULE_MODIFY from "./prompt/proto_module_modify.txt"
import _PROMPT_PROTO_PLANNER_CREATE from "./prompt/proto_planner_create.txt"
import _PROMPT_PROTO_PLANNER_MODIFY from "./prompt/proto_planner_modify.txt"
import _PROMPT_PROTO_TRIAGE from "./prompt/proto_triage.txt"
import _PROMPT_PROTO_PATTERN_PAGE from "./prompt/proto_pattern_page.txt"
import _PROMPT_PROTO_PATTERN_BLOCK from "./prompt/proto_pattern_block.txt"
import _PROMPT_PROTO_INTENT_CONFIRM from "./prompt/proto_intent_confirm.txt"
import _PROMPT_PROTO_WFRAMES from "./prompt/proto_wireframes.txt"

// 3D 场景 agent prompts
import _PROMPT_SCENE_3D_INTENT from "./prompt/scene_3d/scene_3d_intent.txt"
import _PROMPT_SCENE_3D_INTENT_CONFIRM from "./prompt/scene_3d/scene_3d_intent_confirm.txt"
import _PROMPT_SCENE_3D_INTENT_AUDIT from "./prompt/scene_3d/scene_3d_intent_audit.txt"
import _PROMPT_SCENE_3D_PLANNER_CREATE from "./prompt/scene_3d/scene_3d_planner_create.txt"
import _PROMPT_SCENE_3D_PLANNER_MODIFY from "./prompt/scene_3d/scene_3d_planner_modify.txt"
import _PROMPT_SCENE_3D_MODULE_CREATE from "./prompt/scene_3d/scene_3d_module_create.txt"
import _PROMPT_SCENE_3D_MODULE_MODIFY from "./prompt/scene_3d/scene_3d_module_modify.txt"
import _PROMPT_SCENE_3D_TRIAGE from "./prompt/scene_3d/scene_3d_triage.txt"
const data = {
  COMPONENTS_CATALOG,
  COMPONENTS_USAGE,
  DESIGN_SYSTEM_PROMPT,
  A2UI_SCHEMA,
  HTML5_SCHEMA,
  HTML_EXAMPLE,
  CARD_EXAMPLE,
  LIST_EXAMPLE,
  TABS_EXAMPLE,
  FORM_EXAMPLE,
  SCENE_CONFIG_SCHEMA,
  MESH_GEOMETRY_CATALOG,
}

function formatPrompt(template) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}

data.A2UI_JSON_PROTOCOL = formatPrompt(A2UI_JSON_PROTOCOL_RAW)

export const PROMPT_PROTO_INTENT = formatPrompt(_PROMPT_PROTO_INTENT)
export const PROMPT_PROTO_INTENT_AUDIT = formatPrompt(_PROMPT_PROTO_INTENT_AUDIT)
export const PROMPT_PROTO_MODULE_CREATE = formatPrompt(_PROMPT_PROTO_MODULE_CREATE)
export const PROMPT_PROTO_MODULE_MODIFY = formatPrompt(_PROMPT_PROTO_MODULE_MODIFY)
export const PROMPT_PROTO_PLANNER_CREATE = formatPrompt(_PROMPT_PROTO_PLANNER_CREATE)
export const PROMPT_PROTO_PLANNER_MODIFY = formatPrompt(_PROMPT_PROTO_PLANNER_MODIFY)
export const PROMPT_PROTO_TRIAGE = formatPrompt(_PROMPT_PROTO_TRIAGE)
export const PROMPT_PROTO_PATTERN_PAGE = formatPrompt(_PROMPT_PROTO_PATTERN_PAGE)
export const PROMPT_PROTO_PATTERN_BLOCK = formatPrompt(_PROMPT_PROTO_PATTERN_BLOCK)
export const PROMPT_PROTO_INTENT_CONFIRM = formatPrompt(_PROMPT_PROTO_INTENT_CONFIRM)
export const PROMPT_PROTO_WFRAMES = formatPrompt(_PROMPT_PROTO_WFRAMES)

// 3D 场景 agent prompts（formatPrompt 插值 {SCENE_CONFIG_SCHEMA} / {MESH_GEOMETRY_CATALOG}）
export const PROMPT_SCENE_3D_INTENT = formatPrompt(_PROMPT_SCENE_3D_INTENT)
export const PROMPT_SCENE_3D_INTENT_CONFIRM = formatPrompt(_PROMPT_SCENE_3D_INTENT_CONFIRM)
export const PROMPT_SCENE_3D_INTENT_AUDIT = formatPrompt(_PROMPT_SCENE_3D_INTENT_AUDIT)
export const PROMPT_SCENE_3D_PLANNER_CREATE = formatPrompt(_PROMPT_SCENE_3D_PLANNER_CREATE)
export const PROMPT_SCENE_3D_PLANNER_MODIFY = formatPrompt(_PROMPT_SCENE_3D_PLANNER_MODIFY)
export const PROMPT_SCENE_3D_MODULE_CREATE = formatPrompt(_PROMPT_SCENE_3D_MODULE_CREATE)
export const PROMPT_SCENE_3D_MODULE_MODIFY = formatPrompt(_PROMPT_SCENE_3D_MODULE_MODIFY)
export const PROMPT_SCENE_3D_TRIAGE = formatPrompt(_PROMPT_SCENE_3D_TRIAGE)
