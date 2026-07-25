// LLM 实际输出 { output: { rootId, elements, slots, ... }, removedSectionIds }
// 代码用 modifyJson.output ?? modifyJson 提取
// schema 校验 LLM 原始输出格式
const schema = {
  type: "object",
  properties: {
    output: {
      type: "object",
      properties: {
        rootId: { type: "string" },
        elements: {
          type: "array",
          items: { type: "object" },
        },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section_id: { type: "string" },
              element_id: { type: "string" },
              id_prefix: { type: "string" },
              zone_description: { type: "string" },
              object_count_hint: { type: "number" },
              operation: { type: "string", enum: ["create", "modify", "none"] },
            },
            required: ["section_id", "element_id", "id_prefix", "operation"],
          },
        },
        camera: { type: "object" },
        lights: { type: "array", items: { type: "object" } },
        scene: { type: "object" },
      },
      required: ["rootId", "elements", "slots"],
    },
    removedSectionIds: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["output"],
}

export const SCENE_PLANNER_MODIFY_FORMAT = {
  type: "json_schema" as const,
  schema,
}
