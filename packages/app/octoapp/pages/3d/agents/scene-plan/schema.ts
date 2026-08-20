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
          build_detail: {
            type: "string",
            description:
              "具体建法：关键几何+尺寸+材质(hex+roughness/metalness)+结构(网格/间距/位置)+组件 options 关键字段+loadModel src+delete 返回值。供 codegen 照抄，避免 codegen 在 reasoning 里重新设计",
          },
          components: { type: "array", items: { type: "string" } },
          resources: { type: "array", items: { type: "string" } },
        },
        required: ["type", "purpose", "implementation", "build_detail", "components", "resources"],
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
