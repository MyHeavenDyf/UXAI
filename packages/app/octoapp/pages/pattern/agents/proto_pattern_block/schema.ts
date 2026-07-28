const schema = {
  type: "object",
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
        },
        required: ["description"],
        additionalProperties: false,
      },
    },
  },
  required: ["modules"],
  additionalProperties: false,
}

export const PATTERN_BLOCK_FORMAT = {
  type: "json_schema" as const,
  schema,
}
