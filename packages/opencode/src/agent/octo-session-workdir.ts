import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

// insight 会话工作目录对齐(SPEC-INS-028,文档仓 docs/specs/infra/insight-workdir-declaration.md)
//
// 背景:全系统只有一处目录声明 —— Instance.directory(= 用户所选目录)。session.directory 不是
// 独立概念,只是建会话时抄的一份副本(session/session.ts)。于是:
//   · session/system.ts 把它作为 `Working directory` 声明给模型;
//   · shell.ts 拿它当 bash 的 cwd;
//   · write/edit/read/glob/grep 拿它当相对路径的解析基准。
// 而 insight 的产物必须落到 .octo/<sessionID>/outputs/(文件管理面板只读这里)。
//
// 本插件把「声明」和「执行」两层一起对齐到会话产物目录:
//   · 声明层(experimental.chat.system.transform):把模型看到的 `Working directory` 改成产物目录。
//     模型再自行拼绝对路径时,拼出来的就是对的 —— 这是绝对路径长尾的根治,不靠提示词对抗。
//   · 执行层(tool.execute.before):上游把解析基准硬编码成 instance.directory 且不可改
//     (.octo/<sid>/outputs 本身就是从它算出来的,改 instance.directory 自指),
//     所以只能逐工具改写参数。两层互不替代:声明层让模型「想对」,执行层让它「落对」。
//
// 尤其注意 bash:skill 脚本根本不读系统提示词,`--base-dir "."` 里的 `.` 是进程 cwd。
// 对这条通道声明改写零作用,只能靠 workdir 默认值。它恰恰是产物散落的主力通道。
//
// 隔离(不影响其他模块):两道确定性闸门 —— 工具集/hook 判据 × session.agent === "octo_insight"。
// Chat/Design/Studio 走原生行为。绝对路径原样尊重(用户显式指定的位置不改)。

const LOG = "[octo:session-workdir]"
const INSIGHT_AGENT = "octo_insight"

// 以 filePath 落盘**产物**的工具:相对 filePath 重定向到会话产物目录,并强制不越界(见 §3.3)。
// 判据是「是否以 filePath 落盘产物」,不是工具名;新增同类工具往这个集合加即可。
// (apply_patch 不在此:参数是整段 patchText、无单一 filePath,无法同款重定向;insight 也已摘除它。)
const WRITE_TOOLS = new Set(["write", "edit"])
// 以 filePath **读盘**的工具:同样以产物目录为相对基准(否则模型写下 a.md 再 read a.md 读不到),
// 但**不做越界拦截** —— uploads/ 是产物目录的兄弟,`../uploads/x.docx` 是合法读取;
// 越界与否交由原生 external_directory 权限判定。这里设的是「基准」,不是「牢笼」。
const READ_TOOLS = new Set(["read"])
// 以可选 path 指定搜索目录的工具:未给 path 时补成**会话根**(不是产物目录) —— 搜索范围
// 和落点是两件事。收到 outputs 会让「在我材料里找一下 X」搜不到 uploads/(实测 file/ripgrep.ts
// 两条命令都带 --hidden,`.octo/` 今天是能被搜到的,收窄即回归)。会话根同时覆盖 uploads/ 与 outputs/。
const SEARCH_PATH_TOOLS = new Set(["glob", "grep"])
// shell:未显式给 workdir 时补成会话产物目录。
const SHELL_TOOL = "bash"

type SessionMeta = { isInsight: boolean; directory?: string }

// agent/directory 对一个会话不变 —— 按 sessionID 缓存,避免每次调用都拉 session.get。
const cache = new Map<string, SessionMeta>()

/** 本会话的工作区根(= 对模型声明的 Workspace root folder;含 uploads/ outputs/ tmp/)。 */
function sessionDir(directory: string, sessionID: string) {
  return path.join(directory, ".octo", sessionID)
}

/** 本会话的产物目录(= 对模型声明的 Working directory,相对路径的解析基准)。 */
function outputsDir(directory: string, sessionID: string) {
  return path.join(sessionDir(directory, sessionID), "outputs")
}

/**
 * 把某个目录作为默认值交给工具前,先保证它存在(幂等,已存在即空操作)。
 *
 * 会话目录是**惰性创建**的 —— 创建者只有上传接口、文件管理列表接口、write 的 writeWithDirs。
 * 用户没上传过文件、也没开过文件管理时,`.octo/<sid>/` 整体不存在。而我们把不存在的目录塞给:
 *   · bash 的 workdir → spawn 直接失败(cwd 必须预先存在,这是它和 write 的本质差别);
 *   · glob 的 path   → ripgrep 用不存在的 cwd spawn 失败;
 *   · grep 的 path   → **静默搜错目录** —— grep.ts 在 stat 失败时把该路径当「文件」处理,
 *                      cwd 退化成父目录 .octo/,结果恒为空且不报错。
 *
 * 业界判据:**谁设置工作目录,谁保证它存在**(Docker WORKDIR 自动创建;CI runner 在 spawn
 * 前 mkdir workspace;Node child_process 对不存在的 cwd 直接 ENOENT、运行时不兜底)。
 * 我们改写了这些参数,就落在「设置方」这个角色上。仍是惰性 —— 只在真正要交出去的那一刻建。
 */
async function ensureDir(dir: string, ctx: { tool: string; sessionID: string }) {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    // 建不出来就不改默认值,交回原生行为,别把工具引向一个不存在的目录。
    console.error(`${LOG} 目录创建失败,保持原值`, { ...ctx, dir, err })
    return false
  }
  return true
}

/** resolved 是否在 dir 内(dir 自身算在内)。 */
function contains(dir: string, resolved: string) {
  if (resolved === dir) return true
  return resolved.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
}

/**
 * 旧布局绝对路径迁移。insight 会话早期用 `<projectDir>/insight/<sid>/{outputs,uploads}/` 作产物/上传
 * 目录(SPEC-INS-028 之后才改到 `.octo/<sid>/`)。老会话的对话历史里残留这些旧布局绝对路径,模型
 * 「照着上一轮的路径再写一遍」时会复用它们 —— 执行层原样尊重绝对路径,文件落进旧目录,文件管理
 * (只读 .octo/)看不到,「同一会话重新生成还是不对」即此。这里把命中的旧布局绝对路径静默改写到新
 * 布局:只换前缀(insight/<sid> → .octo/<sid>),不动文件名/子路径;项目外的真外部路径(用户显式
 * 指定,如 /Users/.../测试文件/x.txt)不在此范围,仍由调用方原样尊重。
 *
 * 返回 null 表示未命中旧布局,调用方按原策略处理。
 */
function migrateOldLayout(absPath: string, projectDir: string, sessionID: string): string | null {
  const withSep = (p: string) => (p.endsWith(path.sep) ? p : p + path.sep)
  const newSession = path.join(projectDir, ".octo", sessionID)
  // v2 sid-scoped:<projectDir>/insight/<sid>/{outputs,uploads,sources}/... → .octo/<sid>/...
  const oldV2Sid = path.join(projectDir, "insight", sessionID)
  if (absPath === oldV2Sid) return newSession
  const oldV2SidPrefix = withSep(oldV2Sid)
  if (absPath.startsWith(oldV2SidPrefix)) return path.join(newSession, absPath.slice(oldV2SidPrefix.length))
  return null
}

export const OctoSessionWorkdirPlugin: Plugin = async ({ client }) => {
  const metaOf = async (sessionID: string): Promise<SessionMeta | undefined> => {
    const cached = cache.get(sessionID)
    if (cached) return cached
    try {
      const res = await client.session.get({ path: { id: sessionID } })
      const info = (res as { data?: { agent?: string; directory?: string } }).data
      const meta: SessionMeta = { isInsight: info?.agent === INSIGHT_AGENT, directory: info?.directory }
      cache.set(sessionID, meta)
      return meta
    } catch (err) {
      // 读取失败不强改:交回原生行为,不阻断调用。
      console.error(`${LOG} session.get 失败,保持原值`, { sessionID, err })
      return undefined
    }
  }

  return {
    // ── 声明层 ──────────────────────────────────────────────────────────────
    // hook 触发时 output.system 是单元素数组(session/llm.ts 先把 agent prompt + env +
    // instructions + skills join 成一个字符串),所以这里是对 system[0] 做定点行替换。
    // 锚点两端都确定(字面量前缀 + 会话 directory),不做模糊匹配。
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      if (!sessionID) return // agent.ts 那条触发路径不传 sessionID
      const head = output.system[0]
      if (typeof head !== "string" || head.length === 0) return

      const meta = await metaOf(sessionID)
      if (!meta?.isInsight || !meta.directory) return

      // session/system.ts 的 env 模板:`  Working directory: ${ctx.directory}`
      const anchor = `  Working directory: ${meta.directory}`
      if (!head.includes(anchor)) {
        // 响亮失败:上游 env 模板变更的唯一信号。保持原声明不动 —— 执行层仍在,
        // 行为退化为「声明未对齐」的现状,而不是更差。
        console.error(`${LOG} Working directory 锚点未命中,声明未改写`, { sessionID, directory: meta.directory })
        return
      }

      const outputs = outputsDir(meta.directory, sessionID)
      // 只改 Working directory 这一行。
      // `Workspace root folder` 在非 git 目录下被上游置为 "/"(project/project.ts),模型会看到
      // 「工作区根 = 整个磁盘根」这种噪音 —— 但那是**全局**问题(所有 agent 都受影响),留给独立 PR
      // 在 project.ts 一次性修,不在这里做 insight 局部覆盖,免得两套改动叠在同一行上打架。
      // 它只是一行声明,不驱动任何写入(worktree 从来不是任何工具的解析基准)。见 SPEC-INS-028 §3.1。
      output.system[0] = head.replace(anchor, `  Working directory: ${outputs}`)
      console.log(`${LOG} 声明改写`, { sessionID, before: meta.directory, after: outputs })
    },

    // ── 执行层 ──────────────────────────────────────────────────────────────
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      const isWrite = WRITE_TOOLS.has(tool)
      const isRead = READ_TOOLS.has(tool)
      const isSearch = SEARCH_PATH_TOOLS.has(tool)
      const isShell = tool === SHELL_TOOL
      // 闸门 1:只处理这四类工具 —— 其它所有工具/会话在这里零成本放行。
      if (!isWrite && !isRead && !isSearch && !isShell) return

      const args = output.args as Record<string, unknown> | undefined
      if (!args) return

      // 各工具的目标参数名
      const key = isWrite || isRead ? "filePath" : isShell ? "workdir" : "path"
      const raw = args[key]
      const isPathArg = isWrite || isRead

      if (isPathArg) {
        // filePath 必填;缺失不碰。
        if (typeof raw !== "string" || raw.length === 0) return
        if (path.isAbsolute(raw)) {
          // 绝对路径:可能是用户显式指定的项目外位置(原样尊重),也可能是模型从老会话历史复制的
          // 旧布局路径(insight/<sid>/... → 需改写到 .octo/<sid>/...)。先确认 insight 会话(metaOf
          // 带缓存,后续相对路径分支会复用同一缓存项),再判迁移;命中才改写,不命中即真外部路径,原样尊重。
          const m = await metaOf(input.sessionID)
          if (m?.isInsight && m.directory) {
            const migrated = migrateOldLayout(raw, m.directory, input.sessionID)
            if (migrated) {
              args[key] = migrated
              console.log(`${LOG} 旧布局迁移`, { tool, sessionID: input.sessionID, before: raw, after: migrated })
            }
          }
          return
        }
      } else {
        // workdir / path 可选:已显式给出就尊重(含绝对路径);只在缺省时补默认值。
        if (raw !== undefined && raw !== null && raw !== "") return
      }

      // 闸门 2:确认是 insight 会话(session 级 agent 字段,确定性判据),带缓存。
      const meta = await metaOf(input.sessionID)
      if (!meta?.isInsight || !meta.directory) return

      const outputs = outputsDir(meta.directory, input.sessionID)

      if (!isPathArg) {
        // bash 的 cwd = 产物目录(脚本产出即产物);glob/grep 的默认搜索范围 = 会话根
        // (材料在 uploads/,收到 outputs 会让「在材料里找 X」搜不到)。
        const value = isShell ? outputs : sessionDir(meta.directory, input.sessionID)
        // 交出去之前先保证存在 —— 这三个通道都不像 write 那样会自动建目录,见 ensureDir 注释。
        if (!(await ensureDir(value, { tool, sessionID: input.sessionID }))) return
        args[key] = value
        console.log(`${LOG} 默认目录补齐`, { tool, sessionID: input.sessionID, key, value })
        return
      }

      // 相对路径(允许子目录)以产物目录为基准;write 的 fs.writeWithDirs 会自动建父目录。
      const before = raw as string
      const after = path.resolve(outputs, before)
      // 落盘工具强制不越界:静默落回目录根会把越界写变成新的产物散落源,故响亮失败。
      // 读取工具不拦(见 READ_TOOLS 注释),越界与否交原生 external_directory 权限判定。
      if (isWrite && !contains(outputs, after)) {
        console.error(`${LOG} 产物路径越界,拒绝改写`, { tool, sessionID: input.sessionID, filePath: before })
        throw new Error(`filePath 越出会话产物目录,请改用不含 ".." 的相对路径:${before}`)
      }
      args[key] = after
      console.log(`${LOG} 落点重定向`, { tool, sessionID: input.sessionID, before, after })
    },
  }
}
