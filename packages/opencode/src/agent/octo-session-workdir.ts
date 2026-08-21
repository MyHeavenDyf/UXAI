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
// 隔离(不影响其他模块):两道确定性闸门 —— 工具集/hook 判据 × **会话树根会话**的
// agent === "octo_insight"。Chat/Design/Studio 走原生行为。绝对路径原样尊重(用户显式指定的位置不改)。
//
// 为什么判「根会话」而不是「本会话」(SPEC-INS-032 §6):task 子代理跑在 parentID 指向父会话的
// **子 session** 里。按本会话判的话,子代理换个 agent 名(insight_reader)插件整个不生效、产物落裸路径;
// 就算沿用 octo_insight 也会锚到子会话 ID,指向空的 .octo/<childID>/(那里没有 uploads/)。
// **一个会话树 = 一个工作区**,根会话 ID 就是工作区标识 —— 业界共识是子代理隔离的是上下文、
// 不是文件系统(Claude Code 的 subagent 就是「独立上下文窗口 + 同一个工作目录」)。
// 好处是判据不再认 agent 名:任何子代理(我们的 insight_reader / general / 第三方 skill 自带的)
// 落在 insight 会话树下都自动归到同一个工作区,不需要为它们逐个列白名单。

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

// rootSessionID = 会话树根会话的 id(自己就是根时即自身);isInsight / directory 均取自**根会话**。
type SessionMeta = { isInsight: boolean; directory?: string; rootSessionID: string }

// agent/directory/父子关系对一个会话不变 —— 按 sessionID 缓存,避免每次调用都拉 session.get。
const cache = new Map<string, SessionMeta>()

// 上溯深度上限:正常只有 1 层(父 → 子),留足余量。超过即认定数据异常(成环/脏数据),
// 响亮失败而不是无限爬。
const MAX_PARENT_DEPTH = 8

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

export const OctoSessionWorkdirPlugin: Plugin = async ({ client }) => {
  const getSession = async (sessionID: string) => {
    const res = await client.session.get({ path: { id: sessionID } })
    return (res as { data?: { agent?: string; directory?: string; parentID?: string } }).data
  }

  /**
   * 解析某个会话所属**工作区**:沿 parentID 上溯到会话树根,isInsight / directory 均取根会话的。
   * task 子会话由此与父会话共用一个工作区(SPEC-INS-032 §6)。
   *
   * 失败(session.get 挂了 / 超深 / 成环)时**响亮失败 + 退化为「把当前会话当根」**——
   * 那正是 032 之前的行为,不会比现状更差;静默换成别的目录才是最难查的那种 bug。
   */
  const metaOf = async (sessionID: string): Promise<SessionMeta | undefined> => {
    const cached = cache.get(sessionID)
    if (cached) return cached
    try {
      const info = await getSession(sessionID)
      let root = info
      let rootID = sessionID
      let depth = 0
      const seen = new Set<string>([sessionID])
      while (root?.parentID) {
        const parentID = root.parentID
        if (seen.has(parentID) || depth >= MAX_PARENT_DEPTH) {
          console.error(`${LOG} 根会话解析失败,退化为按当前会话取工作区`, {
            sessionID,
            depth,
            err: seen.has(parentID) ? "parent cycle" : "max depth exceeded",
          })
          root = info
          rootID = sessionID
          break
        }
        seen.add(parentID)
        depth += 1
        root = await getSession(parentID)
        rootID = parentID
      }
      const meta: SessionMeta = {
        isInsight: root?.agent === INSIGHT_AGENT,
        directory: root?.directory,
        rootSessionID: rootID,
      }
      if (rootID !== sessionID) console.log(`${LOG} 根会话解析`, { sessionID, rootSessionID: rootID, depth })
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

      const outputs = outputsDir(meta.directory, meta.rootSessionID)
      // 声明即兑现:在把 outputs 写进系统提示的同一刻把它建出来。否则模型拿到这行声明后,
      // 会先用 bash / read / glob 去探测「工作目录是否存在」—— 而执行层对**显式 workdir** 和
      // **绝对 filePath** 都早返回、不走 ensureDir(见下方执行层 isPathArg 与 else 分支),
      // 探测扑空:bash spawn ENOENT、read 抛 File not found、glob 返回空。模型据此判定目录不可访问,
      // 转而把产物写到 /tmp 这类绝对临时路径 —— 绝对路径再次早返回,文件落盘到 outputs 之外,
      // 文件管理面板(只读 outputs/)看不到。在声明层一次性根治:目录先存在,探测就不扑空。
      // mkdir -p 幂等,每轮声明触发开销可忽略;建失败仍照常改写(write 的 writeWithDirs 会兜底)。
      await ensureDir(outputs, { tool: "system", sessionID })
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
        // filePath 必填;缺失或绝对路径(显式指定的位置)不碰。
        if (typeof raw !== "string" || raw.length === 0) return
        if (path.isAbsolute(raw)) return
      } else {
        // workdir / path 可选:已显式给出就尊重(含绝对路径);只在缺省时补默认值。
        if (raw !== undefined && raw !== null && raw !== "") return
      }

      // 闸门 2:确认是 insight 会话(session 级 agent 字段,确定性判据),带缓存。
      const meta = await metaOf(input.sessionID)
      if (!meta?.isInsight || !meta.directory) return

      const outputs = outputsDir(meta.directory, meta.rootSessionID)

      if (!isPathArg) {
        // bash 的 cwd = 产物目录(脚本产出即产物);glob/grep 的默认搜索范围 = 会话根
        // (材料在 uploads/,收到 outputs 会让「在材料里找 X」搜不到)。
        const value = isShell ? outputs : sessionDir(meta.directory, meta.rootSessionID)
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
