/**
 * fastui 代码包导出(SPEC-DES-001 §8.6.2)
 *
 * 为什么不在渲染进程自己打包:`export-zip.mjs` 已经处理了两件前端不容易做对的事 ——
 *   - 用 `lstat` 跳过链接:工程根的 `node_modules` 是指向共享池的链接,跟随就把 1GB 打进去
 *   - 置 ZIP 的 UTF-8 flag:不置的话中文产物名在 Windows 解压全是乱码,而内网中文命名概率很高
 * 所以走 IPC 调脚本,与 fastui-devserver.ts 同一个模式:约定「返回结果对象、永不 throw」。
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import log from "electron-log/main.js"

import { nodeBinOf } from "./fastui-devserver"

const SKILL_NAME = "fastui-vue-creator"
/** 打包本身只是遍历 + zlib,几秒量级;这个上限是防止脚本卡死时按钮永远转圈 */
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000

export type ExportResult =
  | { ok: true; zipPath: string; bytes: number; fileCount: number }
  | { ok: false; error: string }

function readState(sessionDir: string): { envDir?: string; skillDir?: string } | null {
  try {
    return JSON.parse(readFileSync(join(sessionDir, ".octo-fastui.json"), "utf8")) as {
      envDir?: string
      skillDir?: string
    }
  } catch {
    return null
  }
}

/**
 * skill 的实际落点。`.octo-fastui.json` 目前没有 `skillDir` 字段(new-session 不写),
 * 所以按候选逐个 `existsSync` 验 —— 是「文件在不在」的确定判断,不是猜路径。
 * 第一位留给状态文件,skill 以后补上那个字段就直接生效,宿主侧不用再改。
 */
function resolveScript(sessionDir: string, skillDir?: string): string | null {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const candidates = [
    skillDir,
    // 技能实际安装位置:与 skill/index.ts 扫描的 <octoConfig>/skill/ 一致
    join(xdgConfig, "octo", "skill", SKILL_NAME),
    // SPEC-DES-001 §8.6.2 提到的工程内落点,留作兜底
    join(dirname(sessionDir), "skills", SKILL_NAME),
  ]
  for (const dir of candidates) {
    if (!dir) continue
    const script = join(dir, "scripts", "export-zip.mjs")
    if (existsSync(script)) return script
  }
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

/** 打一个干净的交付包。失败以结果对象返回,`error` 已是可直接展示给用户的一句话。 */
export function exportZip(sessionDir: string): Promise<ExportResult> {
  return new Promise<ExportResult>((resolve) => {
    const state = readState(sessionDir)
    if (!state) {
      resolve({ ok: false, error: `读不到会话状态 ${join(sessionDir, ".octo-fastui.json")}` })
      return
    }

    const script = resolveScript(sessionDir, state.skillDir)
    if (!script) {
      resolve({ ok: false, error: `找不到 ${SKILL_NAME} 的 export-zip.mjs,技能可能未安装` })
      return
    }

    // 共享池的 node 优先;它不在时用 Electron 自己的 node 运行时(ELECTRON_RUN_AS_NODE),
    // 这样"环境还没装好但产物已经在磁盘上"也能把包导出来 —— 打包不依赖那 1GB 依赖。
    const poolNode = state.envDir ? nodeBinOf(state.envDir) : null
    const usePoolNode = !!poolNode && existsSync(poolNode)
    const bin = usePoolNode ? poolNode! : process.execPath
    const env = usePoolNode ? { ...process.env } : { ...process.env, ELECTRON_RUN_AS_NODE: "1" }

    let child: ChildProcess
    try {
      child = spawn(bin, [script, `--session-dir=${sessionDir}`], {
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
      log.warn("[fastui] 导出脚本超时", { sessionDir })
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
      log.warn("[fastui] 导出脚本无法执行", { sessionDir, bin, error: String(error) })
      finish({ ok: false, error: `导出脚本无法执行: ${String(error)}` })
    })

    child.on("close", () => {
      const { result, fields } = parseContract(stdout)
      if (result !== "OK") {
        // FAIL 行本身就是「英文错误码: 中文说明」,直接展示;脚本连契约行都没输出时退回 stderr 末尾
        const detail = result?.replace(/^FAIL\s*\|\s*/, "") || stderr.trim().split(/\r?\n/).slice(-3).join(" ")
        // HINT 是契约里定义的「可直接执行的下一步」(§5.1.1),带上比只报错有用
        const hint = fields.HINT ? `${detail}（${fields.HINT}）` : detail
        log.warn("[fastui] 导出失败", { sessionDir, result, hint: fields.HINT, stderr: stderr.slice(-2000) })
        finish({ ok: false, error: hint || "导出脚本未返回结果" })
        return
      }
      const zipPath = fields.ZIP_PATH
      if (!zipPath) {
        finish({ ok: false, error: "导出脚本没有返回代码包路径" })
        return
      }
      log.info("[fastui] 导出完成", { sessionDir, zipPath, bytes: fields.ZIP_BYTES })
      finish({
        ok: true,
        zipPath,
        bytes: Number(fields.ZIP_BYTES ?? 0) || 0,
        fileCount: Number(fields.FILE_COUNT ?? 0) || 0,
      })
    })
  })
}
