const schema = {
  type: "object",
  properties: {
    scene_objects: {
      type: "array",
      items: { type: "object" },
    },
  },
  required: ["scene_objects"],
}

export const SCENE_MODULE_MODIFY_FORMAT = {
  type: "json_schema" as const,
  schema,
}
