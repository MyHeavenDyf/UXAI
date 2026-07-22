const schema = {
  type: "object",
  additionalProperties: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["single", "multiple"] },
      options: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["type", "options"],
    additionalProperties: false,
  },
}

export const SCENE_INTENT_CONFIRM_FORMAT = {
  type: "json_schema" as const,
  schema,
}
