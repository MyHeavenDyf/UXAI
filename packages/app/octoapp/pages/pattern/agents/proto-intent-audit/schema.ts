const schema = {
  type: "object",
  properties: {
    is_pass: { type: "boolean" },
    feedback: { type: "string" },
  },
  required: ["is_pass", "feedback"],
  additionalProperties: false,
}

export const INTENT_AUDIT_FORMAT = {
  type: "json_schema" as const,
  schema,
}
