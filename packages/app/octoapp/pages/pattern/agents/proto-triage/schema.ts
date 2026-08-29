const schema = {
  type: "object",
  properties: {
    routing: { type: "string", enum: ["regenerate", "modify", "chat"] },
    delete: {
      type: "array",
      items: {
        type: "object",
        properties: {
          element_id: { type: "string" },
          action: { type: "string" },
        },
        required: ["element_id", "action"],
        additionalProperties: false,
      },
    },
    add: {
      type: "array",
      items: {
        type: "object",
        properties: { action: { type: "string" } },
        required: ["action"],
        additionalProperties: false,
      },
    },
    modify: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section_id: { type: "string" },
          element_id: { type: "string" },
          action: { type: "string" },
        },
        required: ["section_id", "element_id", "action"],
        additionalProperties: false,
      },
    },
    reply: { type: ["string", "null"] },
    reason: { type: "string" },
    attachment_description: { type: ["string", "null"] },
  },
  required: ["routing", "delete", "add", "modify", "reply", "reason", "attachment_description"],
  additionalProperties: false,
}

export const TRIAGE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
