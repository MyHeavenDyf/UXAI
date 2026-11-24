import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Flag } from "@opencode-ai/core/flag/flag"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: [
          `The arguments provided to the tool are invalid: ${params.error}`,
          ...(Flag.OPENCODE_TOOL_SEARCH
            ? [
                `If "${params.tool}" is a deferred tool (listed in <available-deferred-tools>), call search_tools with {"query": "select:${params.tool}"} to read its schema, then execute_tool with {"tool_name": "${params.tool}", "params": {...}} to run it.`,
              ]
            : []),
        ].join("\n"),
        metadata: {},
      }),
  }),
)
