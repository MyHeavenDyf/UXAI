import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string
  storage: SidecarStorage
  userDataPath: string
  needsMigration: boolean
}

type StopCommand = { type: "stop" }
type SidecarCommand = StartCommand | StopCommand

type SidecarStorage = {
  mode: "legacy" | "app-data-fallback"
  env: Record<string, string>
}

type SidecarMessage =
  | { type: "sqlite"; progress: { type: "InProgress"; value: number } | { type: "Done" } }
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

const parentPort = getParentPort()
let listener: Listener | undefined

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  try {
    prepareSidecarEnv(command.password, command.userDataPath, command.storage)
    ensureLoopbackNoProxy()
    useSystemCertificates()
    const { Database, JsonMigration, Log, Server } = await import("virtual:opencode-server")
    useEnvProxy()
    await Log.init({ level: "INFO" })

    if (command.needsMigration) {
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event: { current: number; total: number }) => {
          parentPort.postMessage({
            type: "sqlite",
            progress: {
              type: "InProgress",
              value: event.total === 0 ? 100 : Math.round((event.current / event.total) * 100),
            },
          })
        },
      })
      parentPort.postMessage({ type: "sqlite", progress: { type: "Done" } })
    }

    listener = await Server.listen({
      port: command.port,
      hostname: command.hostname,
      username: "opencode",
      password: command.password,
      cors: ["oc://renderer"],
    })
    parentPort.postMessage({ type: "ready" })
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  try {
    await listener?.stop()
  } finally {
    listener = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

function prepareSidecarEnv(password: string, userDataPath: string, storage: SidecarStorage) {
  Object.assign(process.env, {
    OCTO_SERVER_USERNAME: "opencode",
    OCTO_SERVER_PASSWORD: password,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
    ...storage.env,
  })
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  // sidecar 是独立 utility process，其 process.env 由 createSidecarEnv() 从主进程 env 快照生成，
  // 不继承主进程后续(useEnvProxy 之后)写入的代理变量，也不读取 ~/.config/octo/proxy_config.json。
  // 因此在 `setGlobalProxyFromEnv()` 前，先主动把 proxy_config.json 里的代理注入到 sidecar 自身 env。
  //
  // 仅 macOS 生效：主进程注入的 proxy 在 macOS 会被 preferAppEnv/loadShellEnv(shell 探测) 覆盖，
  // 导致重启后配置丢失；Windows/Linux 不走该覆盖路径，主进程注入已足以生效，无需重复注入。
  if (process.platform === "darwin") {
    try {
      const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
      const configFile = join(xdgConfig, "octo", "proxy_config.json")
      if (existsSync(configFile)) {
        const config = JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, string | undefined>
        for (const key of ["http_proxy", "https_proxy", "no_proxy"]) {
          const value = config[key]
          if (!value) continue
          process.env[key] = value
          process.env[key.toUpperCase()] = value
        }
      }
    } catch (error) {
      console.warn("failed to load octo proxy config", error)
    }
  }

  try {
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type !== "start") return
  if (typeof command.hostname !== "string") return
  if (typeof command.port !== "number") return
  if (typeof command.password !== "string") return
  if (!isSidecarStorage(command.storage)) return
  if (typeof command.userDataPath !== "string") return
  if (typeof command.needsMigration !== "boolean") return
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    storage: command.storage,
    userDataPath: command.userDataPath,
    needsMigration: command.needsMigration,
  }
}

function isSidecarStorage(value: unknown): value is SidecarStorage {
  if (!value || typeof value !== "object") return false
  const storage = value as Partial<SidecarStorage>
  if (storage.mode !== "legacy" && storage.mode !== "app-data-fallback") return false
  if (!storage.env || typeof storage.env !== "object") return false
  return Object.values(storage.env).every((item) => typeof item === "string")
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}
