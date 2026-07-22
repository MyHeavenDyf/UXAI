const schema = {
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
    lights: { type: "object" },
    scene: { type: "object" },
  },
  required: ["rootId", "elements", "slots"],
}

export const SCENE_PLANNER_MODIFY_FORMAT = {
  type: "json_schema" as const,
  schema,
}
