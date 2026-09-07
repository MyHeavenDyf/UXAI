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
        },
        required: ["section_id", "element_id", "id_prefix"],
      },
    },
  },
  required: ["rootId", "elements", "slots"],
}

export const PLANNER_CREATE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
