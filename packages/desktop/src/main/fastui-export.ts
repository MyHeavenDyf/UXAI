/**
 * fastui 代码包导出(SPEC-DES-001 §8.6.2)
 *
 * 为什么不在渲染进程自己打包:`export-zip.mjs` 已经处理了两件前端不容易做对的事 ——
 *   - 用 `lstat` 跳过链接:工程根的 `node_modules` 是指向共享池的链接,跟随就把 1GB 打进去
 *   - 置 ZIP 的 UTF-8 flag:不置的话中文产物名在 Windows 解压全是乱码,而内网中文命名概率很高
 * 所以走 IPC 调脚本,与 fastui-devserver.ts 同一个模式:约定「返回结果对象、永不 throw」。
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import log from "electron-log/main.js"

import { type FastuiTarget, nodeBinOf, resolveProject } from "./fastui-devserver"
import { effectiveXdgConfigHome } from "./storage"

const SKILL_NAME = "fastui-vue-creator"
/** 打包本身只是遍历 + zlib,几秒量级;这个上限是防止脚本卡死时按钮永远转圈 */
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000
/**
 * 问 server 要 skill 位置的上限。同机回环请求,而且**该 instance 必然是热的**(会话就跑在
 * 它下面,`Skill.all()` 背后那层懒缓存早已建好),所以正常路径是毫秒级。`projectDir` 万一
 * 推错、落到一个冷 instance 上,那边要做一次完整的 skill 发现扫描 —— 这个上限就是为那种
 * 情况兜底:超时走候选链,不拖住导出。
 */
const SKILL_QUERY_TIMEOUT_MS = 3000

type ServerInfo = { url: string; username: string | null; password: string | null }

/** sidecar 就绪时由 index.ts 注入。未就绪(或已退出)时为 null,定位退回候选链 */
let serverInfo: ServerInfo | null = null

export function setServerInfo(info: ServerInfo | null) {
  serverInfo = info
}

export type ExportResult =
  | { ok: true; zipPath: string; bytes: number; fileCount: number }
  | { ok: false; error: string }

/**
 * **问 server 要 skill 的位置 —— 它是扫出这些 skill 的那一方,也是唯一知道它们在哪的。**
 *
 * `Skill.Info.name` 取自 SKILL.md 的 frontmatter,`location` 是 server 扫到的绝对路径
 * (`skill/index.ts` 的 `location: match`,来自 `Glob.scan({ absolute: true })`)。
 * **按 name 找、拿 location,这一对组合是这里的关键**:目录名与 skill 名可以不一致,
 * 宿主拿常量去拼目录名就会落空。2026-09 内网 Mac 的现场正是如此 —— 那台机器上
 * skill 装在 `~/.config/octo/skill/fastui-vue-creator␠/`(目录名尾部多一个空格,
 * Windows 建不出这种名字,所以同版本 Windows 全部正常)。server 照常扫到并加载,
 * 宿主用 `join(…, "fastui-vue-creator")` 则永远 miss。
 *
 * 目录名畸变只是其中一种;`<octoConfig>/skill/` 还依赖 `XDG_CONFIG_HOME`(主进程与
 * sidecar 在 app-data-fallback 模式下会取到不同的值),server 也会扫**项目目录**下的
 * `{skill,skills}/`(`skill/index.ts:197`)—— 装在那里的 skill 宿主无从猜起。
 * 共同点是:宿主那条路是推导,这条是查询。
 *
 * 失败(server 未就绪、请求超时、该 skill 没装)一律返回 null,交给下面的候选链兜底。
 */
async function skillDirFromServer(workspaceDir: string, skillName: string): Promise<string | null> {
  const info = serverInfo
  if (!info) return null
  try {
    const url = new URL("/skill", info.url)
    // instance 路由按目录解析实例(middleware 读 `directory` 查询参数),缺省会落到
    // sidecar 的 cwd —— 那样扫不到装在本项目目录下的 skill
    url.searchParams.set("directory", workspaceDir)

    const headers = new Headers()
    if (info.password) {
      const auth = Buffer.from(`${info.username ?? "opencode"}:${info.password}`).toString("base64")
      headers.set("authorization", `Basic ${auth}`)
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(SKILL_QUERY_TIMEOUT_MS) })
    if (!res.ok) {
      log.warn("[fastui] 查询 skill 位置失败", { status: res.status })
      return null
    }
    const list = (await res.json()) as Array<{ name?: string; location?: string }>
    const hit = Array.isArray(list) ? list.find((item) => item?.name === skillName) : undefined
    if (!hit?.location) return null
    return dirname(hit.location)
  } catch (error) {
    log.warn("[fastui] 查询 skill 位置出错", { error: String(error) })
    return null
  }
}

/** 候选链要读的两个基准路径。测试注入,生产走 `effectiveXdgConfigHome()` / `homedir()` */
export type PathEnv = { xdgConfig?: string; homeDir?: string }

/**
 * skill 的实际落点。先问 server(上面),问不到再走候选链。
 *
 * 候选链里每一条都是 `existsSync` 验「这个文件在不在」的确定判断;但**候选本身是拿常量
 * 拼出来的**,目录名与 skill 名不一致时(2026-09 内网 Mac:目录名尾部多一个空格)整条链
 * 全部落空 —— 所以它只是 server 不可用时的兜底,不是正路。顺序上 server 也优先于状态
 * 文件:后者是建会话那一刻的快照,skill 换过位置(重装、改用项目内副本)就成了死链。
 *
 * 后两条候选看着像重复,不是:候选 #3 走 `effectiveXdgConfigHome()`(storage 感知,
 * app-data-fallback 覆盖时指向 `<userData>/xdg-config`),与 server 扫描的
 * `Global.Path.octoConfig` 同源;候选 #4 是旧版本硬编码部署在 `~/.config/octo/skill`
 * 的存量机器兜底 —— 修复前的机器上两个目录都可能持有内容,两条都要试。
 */
export async function resolveScript(
  workspaceDir: string,
  skillDir?: string,
  env?: PathEnv,
  skillName: string = SKILL_NAME,
): Promise<string | null> {
  const homeDir = env?.homeDir ?? homedir()
  // 后半截**刻意用 `||` 而不是 `??`**:空串的 XDG_CONFIG_HOME 要当成"没设",这跟 server 侧
  // 一致(`xdg-basedir` 就是 `env.XDG_CONFIG_HOME || …`)。用 `??` 的话空串会被当成有效值,
  // 候选 #3 退化成相对路径 `octo/skill/<name>` —— 眼下会被候选 #4 兜住(两者产出逐字相同),
  // 但那是靠另一条候选救,不是这一行自己对;而且那条相对路径会混进 tried 诊断日志误导排查。
  const xdgConfig = env?.xdgConfig ?? effectiveXdgConfigHome()
  const candidates = [
    await skillDirFromServer(workspaceDir, skillName),
    // new-session 写进工程标记(旧布局:会话状态文件)的路径(SPEC-DES-001 §8.6.2)
    skillDir,
    // server 扫描的 <octoConfig>/skill/
    join(xdgConfig, "octo", "skill", skillName),
    // 旧版本 deployBuiltinSkills 硬编码部署的落点,存量机器兜底
    join(homeDir, ".config", "octo", "skill", skillName),
    // SPEC-DES-001 §8.6.2 提到的工作区内落点,留作兜底
    join(workspaceDir, ".octo", "skills", skillName),
  ]
  const tried: string[] = []
  for (const dir of candidates) {
    if (!dir) continue
    const script = join(dir, "scripts", "export-zip.mjs")
    if (existsSync(script)) return script
    tried.push(script)
  }
  // 用户看到的是一句话,定位要靠这里 —— 把试过的路径都记上,省掉一轮来回问
  log.warn("[fastui] 定位不到导出脚本", { workspaceDir, skillName, serverKnown: !!serverInfo, tried })
  return null
}

/** 解析 §5.1.1 的契约行:stdout 只放契约行,过程输出在 stderr */
function parseContract(stdout: string) {
  const fields: Record<string, string> = {}
  let result: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith("RESULT:")) {
      result = trimmed.slice("RESULT:".length).trim()
      continue
    }
    const sep = trimmed.indexOf(": ")
    if (sep > 0) fields[trimmed.slice(0, sep)] = trimmed.slice(sep + 2).trim()
  }
  return { result, fields }
}

/**
 * 打一个干净的交付包。失败以结果对象返回,`error` 已是可直接展示给用户的一句话。
 *
 * 工程按卡片的(工作区, 会话, 产物名)定位,与预览同一个查找函数(SPEC-DES-008 §3.7)——
 * 同一对话可以有多个工程,带了产物名就导出它;老卡片没有产物名时由 resolveProject 按「恰好一个」判定。
 */
export async function exportZip(target: FastuiTarget): Promise<ExportResult> {
  const r = resolveProject(target)
  if (!r.ok) return { ok: false, error: r.error }
  // chart-vue-creator 的工程用它自己的脚本(两份脚本相同,但 skill 装没装是各自的事)
  const skillName = r.state.skill || SKILL_NAME
  const script = await resolveScript(target.workspaceDir, r.state.skillDir, undefined, skillName)
  if (!script) {
    return { ok: false, error: `未找到 ${skillName} 的导出脚本,请确认该技能已安装` }
  }
  return runExportScript(r.projectDir, script, r.state.envDir)
}

/** 跑脚本、解析契约行。与定位分开,这里只负责「把脚本跑完并翻译它的输出」。 */
function runExportScript(projectDir: string, script: string, envDir: string | undefined): Promise<ExportResult> {
  return new Promise<ExportResult>((resolve) => {
    // 共享池的 node 优先;它不在时用 Electron 自己的 node 运行时(ELECTRON_RUN_AS_NODE),
    // 这样"环境还没装好但产物已经在磁盘上"也能把包导出来 —— 打包不依赖那 1GB 依赖。
    const poolNode = envDir ? nodeBinOf(envDir) : null
    const usePoolNode = !!poolNode && existsSync(poolNode)
    const bin = usePoolNode ? poolNode! : process.execPath
    const env = usePoolNode ? { ...process.env } : { ...process.env, ELECTRON_RUN_AS_NODE: "1" }

    let child: ChildProcess
    try {
      child = spawn(bin, [script, `--project-dir=${projectDir}`], {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      resolve({ ok: false, error: `启动导出脚本失败: ${String(error)}` })
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: ExportResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      log.warn("[fastui] 导出脚本超时", { projectDir })
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
      finish({ ok: false, error: "导出超时,请稍后重试" })
    }, EXPORT_TIMEOUT_MS)

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    // spawn 的异步失败(ENOENT、权限不足)没有监听器时会被当成 unhandled error 打爆主进程
    child.on("error", (error) => {
      log.warn("[fastui] 导出脚本无法执行", { projectDir, bin, error: String(error) })
      finish({ ok: false, error: `导出脚本无法执行: ${String(error)}` })
    })

    child.on("close", () => {
      const { result, fields } = parseContract(stdout)
      if (result !== "OK") {
        // FAIL 行本身就是「英文错误码: 中文说明」,直接展示;脚本连契约行都没输出时退回 stderr 末尾
        const detail = result?.replace(/^FAIL\s*\|\s*/, "") || stderr.trim().split(/\r?\n/).slice(-3).join(" ")
        // HINT 是契约里定义的「可直接执行的下一步」(§5.1.1),带上比只报错有用
        const hint = fields.HINT ? `${detail}（${fields.HINT}）` : detail
        log.warn("[fastui] 导出失败", { projectDir, result, hint: fields.HINT, stderr: stderr.slice(-2000) })
        finish({ ok: false, error: hint || "导出脚本未返回结果" })
        return
      }
      const zipPath = fields.ZIP_PATH
      if (!zipPath) {
        finish({ ok: false, error: "导出脚本没有返回代码包路径" })
        return
      }
      log.info("[fastui] 导出完成", { projectDir, zipPath, bytes: fields.ZIP_BYTES })
      finish({
        ok: true,
        zipPath,
        bytes: Number(fields.ZIP_BYTES ?? 0) || 0,
        fileCount: Number(fields.FILE_COUNT ?? 0) || 0,
      })
    })
  })
}
