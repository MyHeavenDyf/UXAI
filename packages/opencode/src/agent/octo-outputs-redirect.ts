import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"

// insight 会话产物落点重定向(SPEC 见 octo-agent docs)
//
// 背景:insight agent 生成交付文件时用 write 工具。write 本体(packages/opencode/src/tool/write.ts,
// 上游共享核心,不改)把**相对路径**默认 join 到 instance.directory(项目根),而不是本会话的
// .octo/<sessionId>/outputs/。此前为把产物导进 outputs(文件管理「生成文件」段从那读),客户端
// 每轮消息都注入一条 `[输出目录] …绝对路径` 的 synthetic 指令去纠偏——弱模型会把这条常驻指令
// 当成"当前要回应的事"复述出来(空问候"你好"也触发,把绝对路径暴露给用户)。
//
// 本插件回到业界标准做法:agent 的相对写入解析到其工作目录(此处 = 本会话 outputs/),模型只写
// 文件名即可、无需知道绝对路径,`[输出目录]` 注入随之删除,暴露问题从根上消失。
//
// 隔离(不影响其他模块)——两道确定性闸门:
//   1. 落盘产物工具集 —— 只碰以 filePath 落盘产物的工具(见 REDIRECT_TOOLS),其它工具零改写、零开销放行。
//      判据是"是否以 filePath 落盘产物",不是工具名;新增同类落盘工具往这个集合加即可。
//      (apply_patch 不在此:参数是整段 patchText、无单一 filePath,无法同款重定向;insight 也已摘除它。)
//   2. session.agent === "octo_insight" —— 只碰 insight 会话,Chat/Design/Studio 的写入走原生行为。
// 绝对路径原样尊重(用户/模型显式指定的位置不改;也兼容过渡期模型仍产出的绝对 outputs 路径)。

const LOG = "[octo:outputs-redirect]"
const INSIGHT_AGENT = "octo_insight"
// 以 filePath 落盘产物、需要重定向到会话 outputs 的工具集(write=新建,edit=改写既有产物)。
const REDIRECT_TOOLS = new Set(["write", "edit"])

type SessionMeta = { isInsight: boolean; directory?: string }

// agent/directory 对一个会话不变 —— 按 sessionID 缓存,避免每次 write 都拉 session.get。
const cache = new Map<string, SessionMeta>()

export const OctoOutputsRedirectPlugin: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // 闸门 1:只处理落盘产物工具(write/edit)—— 其它所有工具/会话在这里零成本放行。
      if (!REDIRECT_TOOLS.has(input.tool)) return

      const args = output.args as { filePath?: unknown } | undefined
      const filePath = args?.filePath
      if (typeof filePath !== "string" || filePath.length === 0) return
      // 绝对路径原样尊重(显式指定的位置 / 过渡期绝对 outputs 路径),不重定向。
      if (path.isAbsolute(filePath)) return

      // 闸门 2:确认是 insight 会话(session 级 agent 字段,确定性判据),带缓存。
      let meta = cache.get(input.sessionID)
      if (!meta) {
        try {
          const res = await client.session.get({ path: { id: input.sessionID } })
          const info = (res as { data?: { agent?: string; directory?: string } }).data
          meta = { isInsight: info?.agent === INSIGHT_AGENT, directory: info?.directory }
          cache.set(input.sessionID, meta)
        } catch (err) {
          // 读取失败不强改:交回 write 原生行为(相对 → 项目根),不阻断写入。
          console.error(`${LOG} session.get 失败,保持原值`, { sessionID: input.sessionID, err })
          return
        }
      }
      if (!meta.isInsight || !meta.directory) return

      // 相对文件名 → 本会话 outputs/;write 的 fs.writeWithDirs 会自动建父目录。
      const outputsDir = path.join(meta.directory, ".octo", input.sessionID, "outputs")
      const before = filePath
      const after = path.join(outputsDir, filePath)
      ;(output.args as { filePath: string }).filePath = after
      console.log(`${LOG} 落点重定向`, { tool: input.tool, sessionID: input.sessionID, before, after })
    },
  }
}
