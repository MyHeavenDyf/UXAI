const schema = {
  type: "object",
  properties: {
    routing: { type: "string", enum: ["create", "modify", "chat"] },
    types: {
      type: "object",
      properties: {
        create: { type: "array", items: { type: "string" } },
        modify: { type: "array", items: { type: "string" } },
      },
      required: ["create", "modify"],
      additionalProperties: false,
    },
    reply: { type: "string" },
    reason: { type: "string" },
    attachment_description: { type: ["string", "null"] },
  },
  required: ["routing", "types", "reply", "reason", "attachment_description"],
  additionalProperties: false,
}

export const SCENE_TRIAGE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
