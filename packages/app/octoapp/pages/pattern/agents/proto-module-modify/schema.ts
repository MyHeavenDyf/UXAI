const schema = {
  type: "object",
  properties: {
    state: { type: "object" },
    rootId: { type: "string" },
    elements: {
      type: "array",
      items: { type: "object" },
    },
  },
  required: ["state", "rootId", "elements"],
}

export const MODULE_MODIFY_FORMAT = {
  type: "json_schema" as const,
  schema,
}
