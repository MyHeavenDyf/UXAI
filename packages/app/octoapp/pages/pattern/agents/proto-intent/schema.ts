const schema = {
  type: "object",
  properties: {
    userInput: { type: "string" },
    intentAnalysis: { type: "string" },
    layoutDescription: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
    sectionDetailList: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          intent: { type: "string" },
          function: { type: "string" },
          layout: { type: "string" },
          elements: { type: "string" },
          data: { type: "object" },
        },
        required: ["id", "name"],
      },
    },
  },
  required: ["userInput", "intentAnalysis", "layoutDescription", "sections", "sectionDetailList"],
}

export const INTENT_FORMAT = {
  type: "json_schema" as const,
  schema,
}
