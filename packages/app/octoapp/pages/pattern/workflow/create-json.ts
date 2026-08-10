import proto_pattern_page from "../agents/proto-pattern-page"
import proto_pattern_block from "../agents/proto_pattern_block"
import proto_page_create from "../agents/proto-page-create"
import { withAgentError } from "../utils/error-msg"
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
} from "../checkpoint/checkpoint"

export type ProtoCreateJsonInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户输入
  userInput: string
  // 额外补充信息，透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 历史文件保存地址
  checkpointDir: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

// 意图确认（返回缺失维度的选项清单，由前端渲染 UI 暂停等待用户）
export async function create_pattern_page(inputCtx: ProtoCreateJsonInput) {
  // 调用前先存 checkpoint（只有 userInput，没有 options），上一轮 agent 报错也能重试
  await saveCheckpoint(inputCtx.checkpointDir, inputCtx.rootSession, {
    stage: "page_matching",
    userInput: inputCtx.userInput,
    designSystem: inputCtx.extra?.designSystem as string,
    rootSessionId: inputCtx.rootSession,
    createdAt: Date.now(),
  })
  const result = await withAgentError("proto_pattern_page", () => proto_pattern_page(inputCtx))
  // agent 成功后无论是否有匹配结果都落盘 options，这样切换 session 回来时能区分「空匹配」或「agent 报错」
  await saveCheckpoint(inputCtx.checkpointDir, inputCtx.rootSession, {
    stage: "page_matching",
    userInput: inputCtx.userInput,
    designSystem: inputCtx.extra?.designSystem as string,
    rootSessionId: inputCtx.rootSession,
    createdAt: Date.now(),
    options: { results: result.results },
  })
  return result
}

// block 模板匹配：调 proto_pattern_block + 落盘 blockMatches
export async function create_block_match(inputCtx: ProtoCreateJsonInput): Promise<{ matches: any[]; previewUrls: Map<string, string> }> {
  const sid = inputCtx.rootSession
  const pagePattern = (inputCtx.extra?.pagePattern as string) ?? ""
  // 推进 stage 到 block_matching，同时持久化 pagePattern（重试 + 恢复时复用）
  if (inputCtx.checkpointDir) {
    const ckpt = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (ckpt) {
      ckpt.stage = "block_matching"
      ckpt.userInput = inputCtx.userInput
      ckpt.pagePattern = pagePattern
      await saveCheckpoint(inputCtx.checkpointDir, sid, ckpt)
    }
  }
  const result = await proto_pattern_block(inputCtx)
  // 落盘 blockMatches
  if (inputCtx.checkpointDir) {
    const ckpt = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (ckpt) {
      ckpt.blockMatches = result.matches
      await saveCheckpoint(inputCtx.checkpointDir, sid, ckpt)
    }
  }
  return { matches: result.matches, previewUrls: new Map() }
}

// 阶段 2：单次整页生成（userInput + 选中的 block patterns → 完整页面 JSON）
export async function create_page_json(
  inputCtx: ProtoCreateJsonInput,
  onFinished: (finalJson: { pageJson: any }) => Promise<void>,
) {
  const sid = inputCtx.rootSession

  // 落盘 checkpoint：阶段推进到 page_create，并持久化 patterns 供断点恢复/重试
  if (inputCtx.checkpointDir) {
    await saveCheckpoint(inputCtx.checkpointDir, sid, {
      stage: "page_create",
      userInput: inputCtx.userInput,
      designSystem: inputCtx.extra?.designSystem as string,
      patterns: inputCtx.extra?.patterns as any[],
      rootSessionId: sid,
      createdAt: Date.now(),
    })
  }

  // 单次整页生成：proto_page_create 吃 userInput + 选中的 block patterns，一次产出整页 JSON
  const result = await withAgentError("proto_page_create", () =>
    proto_page_create({
      ...inputCtx,
      patterns: inputCtx.extra?.patterns as any[],
    })
  )

  const pageJson = result.ui_json

  // 生成成功，清理 checkpoint
  if (inputCtx.checkpointDir) {
    await clearCheckpoint(inputCtx.checkpointDir, sid)
  }

  await onFinished({ pageJson })
}
