const schema = {
  type: "object",
  properties: {
    userInput: { type: "string" },
    sceneAnalysis: { type: "string" },
    layoutDescription: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          layout: { type: "string" },
          elements: { type: "string" },
        },
        required: ["id", "name", "description", "layout", "elements"],
      },
    },
    sectionDetailList: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          intent: { type: "string" },
          function: { type: "string" },
        },
      },
    },
  },
  required: ["userInput", "sceneAnalysis", "layoutDescription", "sections"],
}

export const SCENE_INTENT_FORMAT = {
  type: "json_schema" as const,
  schema,
}
