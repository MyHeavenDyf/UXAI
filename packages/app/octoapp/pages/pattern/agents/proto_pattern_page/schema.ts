const schema = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number" },
        },
        required: ["name", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
}

export const PATTERN_PAGE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
