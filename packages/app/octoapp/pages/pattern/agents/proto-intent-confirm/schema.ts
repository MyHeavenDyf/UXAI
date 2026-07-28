const schema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          score: { type: "number" },
        },
        required: ["id", "name", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
}

export const INTENT_CONFIRM_FORMAT = {
  type: "json_schema" as const,
  schema,
}
