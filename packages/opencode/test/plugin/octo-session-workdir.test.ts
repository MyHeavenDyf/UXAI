import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OctoSessionWorkdirPlugin } from "../../src/agent/octo-session-workdir"

// SPEC-INS-028 会话工作目录对齐:声明层(Working directory)+ 执行层(工具参数基准)。
// 两层互不替代 —— 声明层让模型「想对」(它自行拼的绝对路径就是对的),执行层让它「落对」
// (上游把解析基准硬编码成 instance.directory,只能逐工具改参数)。

type BeforeHook = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: unknown },
) => Promise<void>

type SystemHook = (
  input: { sessionID?: string; model: unknown },
  output: { system: string[] },
) => Promise<void>

const DIR = "/w/测试 insight"
const SID = "ses_abc"
const OUTPUTS = path.join(DIR, ".octo", SID, "outputs")

// 每个用例用独立 sessionID 前缀,避免插件模块级 meta 缓存串场。
let seq = 0
function sid(agent: string) {
  seq += 1
  return { id: `${SID}_${agent}_${seq}`, agent }
}

// directory 显式传 null 表示「session 没有 directory 字段」;不用 undefined —— 那会触发默认值。
async function hooks(session: { id: string; agent: string }, dir: string | null = DIR) {
  const directory = dir ?? undefined
  const client = {
    session: {
      get: async ({ path: p }: { path: { id: string } }) =>
        p.id === session.id ? { data: { agent: session.agent, directory } } : { data: undefined },
    },
  }
  const h = await OctoSessionWorkdirPlugin({ client } as never)
  return {
    before: h["tool.execute.before"] as unknown as BeforeHook,
    system: h["experimental.chat.system.transform"] as unknown as SystemHook,
  }
}

function envPrompt(directory = DIR, worktree = "/") {
  return [
    "你是专业的用户研究分析师。",
    "<env>",
    `  Working directory: ${directory}`,
    `  Workspace root folder: ${worktree}`,
    "  Platform: darwin",
    "</env>",
  ].join("\n")
}

function outputsOf(id: string) {
  return path.join(DIR, ".octo", id, "outputs")
}

describe("声明层:Working directory 改写", () => {
  test("insight 会话:声明改成会话产物目录,工作区根改成选中目录", async () => {
    const s = sid("octo_insight")
    const { system } = await hooks(s)
    const out = { system: [envPrompt()] }
    await system({ sessionID: s.id, model: {} }, out)
    expect(out.system[0]).toContain(`  Working directory: ${outputsOf(s.id)}`)
    // Workspace root folder 本版**刻意不动**:worktree 在非 git 目录下为 "/" 是全局问题,
    // 留给独立 PR 在 project.ts 一次性修(SPEC-INS-028 §3.1)。这里守住「没被顺手改掉」。
    expect(out.system[0]).toContain("  Workspace root folder: /")
    // 只动这两行,其余原样
    expect(out.system[0]).toContain("你是专业的用户研究分析师。")
    expect(out.system[0]).toContain("  Platform: darwin")
  })

  test("非 insight 会话:声明原样不动", async () => {
    const s = sid("octo_design")
    const { system } = await hooks(s)
    const out = { system: [envPrompt()] }
    await system({ sessionID: s.id, model: {} }, out)
    expect(out.system[0]).toBe(envPrompt())
  })

  test("无 sessionID(agent.ts 那条触发路径):no-op", async () => {
    const s = sid("octo_insight")
    const { system } = await hooks(s)
    const out = { system: [envPrompt()] }
    await system({ model: {} }, out)
    expect(out.system[0]).toBe(envPrompt())
  })

  test("锚点未命中(上游 env 模板变更):保持原声明,不瞎改", async () => {
    const s = sid("octo_insight")
    const { system } = await hooks(s)
    const broken = "你是专业的用户研究分析师。\n<env>\n  Cwd: /w/测试 insight\n</env>"
    const out = { system: [broken] }
    await system({ sessionID: s.id, model: {} }, out)
    expect(out.system[0]).toBe(broken)
  })
})

describe("执行层:落盘工具(write/edit)", () => {
  test("相对文件名 → 会话产物目录", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "用户画像.md" }
    await before({ tool: "write", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe(path.join(outputsOf(s.id), "用户画像.md"))
  })

  test("相对子目录:允许,不再被禁(skill 中间产物收纳)", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "过程稿/01-画像草稿.md" }
    await before({ tool: "edit", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe(path.join(outputsOf(s.id), "过程稿", "01-画像草稿.md"))
  })

  test("越界的相对路径:响亮失败,不静默落回目录根", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "../../escape.md" }
    await expect(before({ tool: "write", sessionID: s.id, callID: "c1" }, { args })).rejects.toThrow("越出会话产物目录")
    expect(args.filePath).toBe("../../escape.md")
  })

  test("绝对路径:原样尊重(用户显式指定的位置)", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "/w/别处/x.md" }
    await before({ tool: "write", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe("/w/别处/x.md")
  })

  test("非 insight 会话:原生行为", async () => {
    const s = sid("octo_make")
    const { before } = await hooks(s)
    const args = { filePath: "a.md" }
    await before({ tool: "write", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe("a.md")
  })
})

describe("执行层:读取工具(read)", () => {
  test("相对路径以产物目录为基准(写下 a.md 后能 read a.md)", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "a.md" }
    await before({ tool: "read", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe(path.join(outputsOf(s.id), "a.md"))
  })

  test("读兄弟目录 uploads/ 不拦:设的是基准不是牢笼,越界交原生权限判定", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { filePath: "../uploads/访谈稿.docx" }
    await before({ tool: "read", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe(path.join(DIR, ".octo", s.id, "uploads", "访谈稿.docx"))
  })
})

describe("执行层:shell 与搜索工具的默认目录", () => {
  test("bash 未给 workdir:补成会话产物目录(skill 脚本落盘的主力通道)", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args: Record<string, unknown> = { command: "python init_run_dir.py --base-dir .", description: "建目录" }
    await before({ tool: "bash", sessionID: s.id, callID: "c1" }, { args })
    expect(args.workdir).toBe(outputsOf(s.id))
    expect(args.command).toBe("python init_run_dir.py --base-dir .")
  })

  test("bash 显式给了 workdir:尊重,不覆盖", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args: Record<string, unknown> = { command: "ls", workdir: "/w/别处", description: "列目录" }
    await before({ tool: "bash", sessionID: s.id, callID: "c1" }, { args })
    expect(args.workdir).toBe("/w/别处")
  })

  test("glob/grep 未给 path:补成会话根而非产物目录(材料在 uploads/,要搜得到)", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const sessionRoot = path.join(DIR, ".octo", s.id)

    const globArgs: Record<string, unknown> = { pattern: "*.md" }
    await before({ tool: "glob", sessionID: s.id, callID: "c1" }, { args: globArgs })
    expect(globArgs.path).toBe(sessionRoot)

    const grepArgs: Record<string, unknown> = { pattern: "洞察" }
    await before({ tool: "grep", sessionID: s.id, callID: "c2" }, { args: grepArgs })
    expect(grepArgs.path).toBe(sessionRoot)
    // 收到 outputs 会让「在我材料里找一下 X」搜不到 uploads/ —— 这是本用例守的回归
    expect(grepArgs.path).not.toBe(outputsOf(s.id))
  })

  test("glob/grep 显式给了 path:尊重,不覆盖", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args: Record<string, unknown> = { pattern: "*.md", path: "/w/别处" }
    await before({ tool: "glob", sessionID: s.id, callID: "c1" }, { args })
    expect(args.path).toBe("/w/别处")
  })
})

describe("失败与隔离", () => {
  test("无关工具:零改写", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s)
    const args = { name: "interview-analysis" }
    await before({ tool: "skill", sessionID: s.id, callID: "c1" }, { args })
    expect(args).toEqual({ name: "interview-analysis" })
  })

  test("session.directory 缺失:保持原值,不阻断调用", async () => {
    const s = sid("octo_insight")
    const { before } = await hooks(s, null)
    const args = { filePath: "a.md" }
    await before({ tool: "write", sessionID: s.id, callID: "c1" }, { args })
    expect(args.filePath).toBe("a.md")
  })

  test("产物目录常量与 SPEC-INS-014 布局一致", () => {
    expect(OUTPUTS).toBe(path.join(DIR, ".octo", SID, "outputs"))
  })
})
