import { Effect, Schema } from "effect"
import * as Tool from "../tool"

/**
 * request_pattern — 信号工具。
 *
 * 主 agent 判断"需要生成新页面"时调用此工具。execute 本身不执行匹配，
 * 只返回一个确认信号。前端监听到此 tool call 后接管，跑 pattern_page → block_match
 * 子流程，用户选完后把选中模板数据作为新消息发回主 agent 继续生成。
 */
export const RequestPatternTool = Tool.define(
  "request_pattern",
  Effect.gen(function* () {
    return {
      description:
        "当判断需要生成新页面时调用此工具，传入用户需求。调用后必须结束本轮回复（输出一句简短状态），不要自行生成页面。前端会接管执行模板匹配流程，用户选定模板后会把数据发回，届时再生成。",
      parameters: Schema.Struct({
        userRequirement: Schema.String.annotate({
          description: "用户的页面需求描述，用于匹配模板",
        }),
      }),
      execute: (params: { userRequirement: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          return {
            title: "Pattern Selection Requested",
            output: `PATTERN_SELECTION_REQUIRED. 前端将接管执行模板匹配流程。请结束本轮回复，等待用户选定模板后继续生成。`,
            metadata: {
              userRequirement: params.userRequirement,
            },
          }
        }),
    }
  }),
)
