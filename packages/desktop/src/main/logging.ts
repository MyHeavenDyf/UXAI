import log from "electron-log/main.js"
import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000

// SPEC-INS-011 阶段3:renderer console 转发到独立文件 insight-debug.log(同 logs 目录),
// 不污染主进程 main.log;独立 5MB 滚动,沿用 cleanup() 的 7 天清理。
export const insightDebugLog = log.create({ logId: "insight-debug" })

export function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024
  insightDebugLog.transports.file.fileName = "insight-debug.log"
  insightDebugLog.transports.file.maxSize = 5 * 1024 * 1024
  insightDebugLog.transports.console.level = false // 不重复打到主进程 stdout
  initConsoleTransport()
  cleanup()
  return log
}

export function tail(): string {
  try {
    const path = log.transports.file.getFile().path
    const contents = readFileSync(path, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

function cleanup() {
  const path = log.transports.file.getFile().path
  const dir = dirname(path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    try {
      const info = statSync(file)
      if (!info.isFile()) continue
      if (info.mtimeMs < cutoff) unlinkSync(file)
    } catch {
      continue
    }
  }
}

function initConsoleTransport() {
  const write = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      write(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EPIPE"
}
