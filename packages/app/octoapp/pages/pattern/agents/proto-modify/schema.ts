const schema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      op: { type: "string" },
      path: { type: "string" },
      value: {},
      element_id: { type: "string" },
      old_id: { type: "string" },
      new_id: { type: "string" },
      remove_subtree: { type: "boolean" },
      component: { type: "string" },
    },
    required: ["op"],
  },
}

export const MODIFY_FORMAT = {
  type: "json_schema" as const,
  schema,
}
