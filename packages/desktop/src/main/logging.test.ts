import { expect, test } from "bun:test"
import log from "electron-log/main.js"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initLogging, logSidecarOutput } from "./logging"

test("writes config diagnostics beside main.log without mixing ordinary sidecar logs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "octo-design-log-"))
  const resolvePath = log.transports.file.resolvePathFn
  const consoleLevel = log.transports.console.level
  log.transports.file.resolvePathFn = () => join(directory, "main.log")
  log.transports.console.level = false
  try {
    initLogging()
    logSidecarOutput('[octo:config] {"stage":"request","directory":"D:\\\\中文&CANN"}', "stdout")
    logSidecarOutput('[octo:config] {"stage":"request:failed","kind":"Body"}', "stderr")
    logSidecarOutput("ordinary-sidecar-output", "stdout")
    logSidecarOutput("ordinary-sidecar-error", "stderr")
    const design = await readFile(join(directory, "design.log"), "utf8")
    const main = await readFile(join(directory, "main.log"), "utf8")
    expect(design).toContain("[octo:config]")
    expect(design).toContain("request:failed")
    expect(design).toContain("中文&CANN")
    expect(design).not.toContain("ordinary-sidecar")
    expect(main).toContain("ordinary-sidecar-output")
    expect(main).toContain("ordinary-sidecar-error")
    expect(main).not.toContain("[octo:config]")
  } finally {
    log.transports.file.resolvePathFn = resolvePath
    log.transports.console.level = consoleLevel
    await rm(directory, { recursive: true, force: true })
  }
})
