const schema = {
  type: "object",
  properties: {
    routing: { type: "string", enum: ["create", "modify", "patch", "chat"] },
    types: {
      type: "object",
      properties: {
        create: { type: "array", items: { type: "string" } },
        modify: { type: "array", items: { type: "string" } },
      },
      required: ["create", "modify"],
      additionalProperties: false,
    },
    patchOps: {
      type: "array",
      description:
        "routing=patch 时输出；基于原场景的局部增删查改 ops。set_instance 改子实例材质/transform；set_type_transform 改顶层 type 整体的 transform（整物移动/旋转/缩放）。",
      items: {
        oneOf: [
          {
            type: "object",
            description: "改一个子实例（部件）的材质/transform。__id 必须取自 [可 patch 候选 __id 清单]。",
            properties: {
              op: { type: "string", enum: ["set_instance"] },
              __id: {
                type: "string",
                description: "目标子实例 __id，必须取自 [可 patch 候选 __id 清单]（严禁臆造）",
              },
              material: {
                type: "object",
                description: "材质标量字段；color 必须 #rrggbb 字符串",
                properties: {
                  type: { type: "string" },
                  color: { type: "string" },
                  emissive: { type: "string" },
                  emissiveIntensity: { type: "number" },
                  roughness: { type: "number" },
                  metalness: { type: "number" },
                  opacity: { type: "number" },
                  transparent: { type: "boolean" },
                  wireframe: { type: "boolean" },
                  flatShading: { type: "boolean" },
                },
                additionalProperties: true,
              },
              transform: {
                type: "object",
                description: "子实例 transform 字段；rotation 存弧度",
                properties: {
                  position: { type: "array", items: { type: "number" } },
                  rotation: { type: "array", items: { type: "number" } },
                  scale: { type: "array", items: { type: "number" } },
                },
                additionalProperties: false,
              },
            },
            required: ["op", "__id"],
            additionalProperties: false,
          },
          {
            type: "object",
            description:
              "改顶层 type 节点整体（整个物体）的 transform。用于「把台灯放到地上」「机柜整体前移」等整物移动/旋转/缩放——目标是一个完整物体而非其部件。type+nodeId 取自 [当前场景已有 type 分组]（顶层节点）。",
            properties: {
              op: { type: "string", enum: ["set_type_transform"] },
              type: { type: "string", description: "顶层 type 名（如 desk_lamp / room），取自 [当前场景已有 type 分组]" },
              nodeId: { type: "string", description: "可选；多同类物体时显式指定节点 id（如 lamp-1）。单物可省略——host 按 type 唯一节点反推" },
              transform: {
                type: "object",
                description: "整物 transform；rotation 存弧度。只写要改的字段，未写不动",
                properties: {
                  position: { type: "array", items: { type: "number" } },
                  rotation: { type: "array", items: { type: "number" } },
                  scale: { type: "array", items: { type: "number" } },
                },
                additionalProperties: false,
              },
            },
            required: ["op", "type", "transform"],
            additionalProperties: false,
          },
          {
            type: "object",
            description:
              "删一个子实例（部件）。把其 __id 加进 handler 的 SUB_SKIP 删除集合，handler 创建点跳过该实例 = 删除。__id 必须取自 [可 patch 候选 __id 清单]（循环实例如 rack-3 不在清单 = 删不了，走 modify）。",
            properties: {
              op: { type: "string", enum: ["skip_instance"] },
              __id: {
                type: "string",
                description: "要删的子实例 __id，必须取自 [可 patch 候选 __id 清单]（严禁臆造）",
              },
            },
            required: ["op", "__id"],
            additionalProperties: false,
          },
          {
            type: "object",
            description:
              "加一个同质子实例（循环型 handler 加同质子物，如「加一排机柜」追加同款 rack）。把 {cid,position,rotation?,material?} 加进 handler 的 SUB_ADD 数组，主循环后 for...of 补创建。cid 须 `${nodeId}-` 起头（host 反查 type 靠前缀）；position 必填（新实例放哪由你推断）；type+nodeId 取自 [当前场景已有 type 分组]。块型加新子物（如「加个鱼缸」新组件）→ modify。",
            properties: {
              op: { type: "string", enum: ["add_instance"] },
              type: { type: "string", description: "顶层 type 名（如 server_racks / room），取自 [当前场景已有 type 分组]" },
              nodeId: { type: "string", description: "该 type 下要追加子实例的顶层节点 id（host 靠它定位 handler + cid 前缀）" },
              cid: { type: "string", description: "新实例 cid，须以 `${nodeId}-` 起头（如 server-room-1-rack-30）；不取自候选清单（是新实例）" },
              position: {
                type: "array",
                items: { type: "number" },
                description: "新实例位置 [x,y,z]，必填",
              },
              rotation: {
                type: "array",
                items: { type: "number" },
                description: "新实例旋转（弧度），可选",
              },
              material: {
                type: "object",
                description: "新实例材质标量字段；color 必须 #rrggbb 字符串",
                properties: {
                  type: { type: "string" },
                  color: { type: "string" },
                  emissive: { type: "string" },
                  emissiveIntensity: { type: "number" },
                  roughness: { type: "number" },
                  metalness: { type: "number" },
                  opacity: { type: "number" },
                  transparent: { type: "boolean" },
                  wireframe: { type: "boolean" },
                  flatShading: { type: "boolean" },
                },
                additionalProperties: true,
              },
            },
            required: ["op", "type", "nodeId", "cid", "position"],
            additionalProperties: false,
          },
          {
            type: "object",
            description:
              "通用改代码路线（CRUD 主线）：对当前 handler 源码做 search→replace（Aider 式精确匹配，search 须 verbatim 且唯一匹配）。覆盖数据补丁够不着的「烘在代码里的值」——墙高常量、批量材质色（循环内 color 字面量）、循环数量（i<N 上界）、删单部件（删 group.add(<obj>); 行=不显示=删）、加/删一排（改位置数组字面量增删元素）。type 取自 [当前场景已有 type 分组]；edits 的 search 须从 [当前 handler 源码] 照搬。search 匹配 0 或 >1 处 → host fallback modify。",
            properties: {
              op: { type: "string", enum: ["edit_code"] },
              type: { type: "string", description: "顶层 type 名，取自 [当前场景已有 type 分组]" },
              edits: {
                type: "array",
                description: "search→replace 对，按序应用。每条 search 须从 [当前 handler 源码] 照搬且唯一匹配",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    search: { type: "string", description: "须从 [当前 handler 源码] 照搬的唯一片段（含缩进）" },
                    replace: { type: "string", description: "替换为的新片段" },
                  },
                  required: ["search", "replace"],
                  additionalProperties: false,
                },
              },
            },
            required: ["op", "type", "edits"],
            additionalProperties: false,
          },
        ],
      },
    },
    reply: { type: "string" },
    reason: { type: "string" },
    attachment_description: { type: ["string", "null"] },
  },
  required: ["routing", "types", "reply", "reason", "attachment_description"],
  additionalProperties: false,
}

export const SCENE_TRIAGE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
