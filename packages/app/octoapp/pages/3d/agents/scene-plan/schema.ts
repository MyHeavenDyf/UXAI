const schema = {
  type: "object",
  properties: {
    scene_description: { type: "string" },
    types: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          purpose: { type: "string" },
          implementation: { type: "string", enum: ["native", "component", "model"] },
          components: { type: "array", items: { type: "string" } },
          resources: { type: "array", items: { type: "string" } },
        },
        required: ["type", "purpose", "implementation", "components", "resources"],
        additionalProperties: false,
      },
    },
    camera: { type: "object" },
    lights: { type: "array", items: { type: "object" } },
    scene: { type: "object" },
  },
  required: ["scene_description", "types", "camera", "lights", "scene"],
  additionalProperties: false,
}

export const SCENE_PLAN_FORMAT = {
  type: "json_schema" as const,
  schema,
}
