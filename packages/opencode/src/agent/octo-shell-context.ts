import type { Plugin } from "@opencode-ai/plugin"

// shell 会话上下文注入(SPEC-DES-008 §3.3,文档仓 docs/specs/design/fastui-workspace-layout.md)
//
// 给每次 shell 调用注入两个环境变量,供 skill 脚本确定「本对话是谁、工作区在哪」:
//   OCTO_SESSION_ID    —— **根会话** id(沿 parentID 上溯):skill 跑在 task 子会话里时,
//                         拿到的仍是用户看到的那个对话
//   OCTO_WORKSPACE_DIR —— 根会话的 directory(= 用户所选的工作区)
// 两者 server 侧都确定可得、与工作区布局(普通 / 代码)无关,所以对所有 agent 注入也无害。
// 「产物该放哪」不在这里注入:工作区分类只存在前端,server 不知道。

type Root = { sessionID: string; directory?: string }

// 父子关系与 directory 对一个会话不变 —— 按 sessionID 缓存,避免每次 shell 调用都拉 session.get。
const cache = new Map<string, Root>()

// 上溯深度上限:正常只有 1 层(父 → 子)。超过即认定数据异常(成环/脏数据),不再往上爬。
const MAX_PARENT_DEPTH = 8

const LOG = "[octo:shell-context]"

export const OctoShellContextPlugin: Plugin = async ({ client, directory }) => {
  const getSession = async (sessionID: string) => {
    const res = await client.session.get({ path: { id: sessionID } })
    return (res as { data?: { directory?: string; parentID?: string } }).data
  }

  /**
   * 解析根会话。失败(session.get 挂了 / 超深 / 成环)时退化为「把当前会话当根」并记日志 ——
   * 后果只是 skill 把子会话当成另一个对话(会多问一次),不会建错位置。
   */
  const rootOf = async (sessionID: string): Promise<Root> => {
    const cached = cache.get(sessionID)
    if (cached) return cached
    try {
      const info = await getSession(sessionID)
      let node = info
      let rootID = sessionID
      const seen = new Set<string>([sessionID])
      while (node?.parentID) {
        const parentID = node.parentID
        if (seen.has(parentID) || seen.size > MAX_PARENT_DEPTH) {
          console.error(`${LOG} 根会话解析失败,按当前会话处理`, { sessionID, err: seen.has(parentID) ? "parent cycle" : "max depth exceeded" })
          node = info
          rootID = sessionID
          break
        }
        seen.add(parentID)
        node = await getSession(parentID)
        rootID = parentID
      }
      const root: Root = { sessionID: rootID, directory: node?.directory }
      cache.set(sessionID, root)
      return root
    } catch (err) {
      console.error(`${LOG} session.get 失败,按当前会话处理`, { sessionID, err })
      return { sessionID }
    }
  }

  return {
    "shell.env": async (input, output) => {
      if (!input.sessionID) return
      const root = await rootOf(input.sessionID)
      output.env.OCTO_SESSION_ID = root.sessionID
      const workspace = root.directory ?? directory
      if (workspace) output.env.OCTO_WORKSPACE_DIR = workspace
    },
  }
}
