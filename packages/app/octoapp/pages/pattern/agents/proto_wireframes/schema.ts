const schema = {
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
}

export const WIREFRAMES_FORMAT = {
  type: "json_schema" as const,
  schema,
}
