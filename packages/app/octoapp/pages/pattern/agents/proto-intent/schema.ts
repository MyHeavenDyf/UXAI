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
          layout: { type: "string" },
          elements: { type: "string" },
          data: { type: "object" },
          patternId: { type: ["string", "number"] },
        },
        required: ["id", "name", "description", "layout", "elements"],
      },
    },
  },
  required: ["userInput", "intentAnalysis", "layoutDescription", "sections"],
}

export const INTENT_FORMAT = {
  type: "json_schema" as const,
  schema,
}
