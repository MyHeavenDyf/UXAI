import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

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
  userDataPath: string
  needsMigration: boolean
}

type StopCommand = {
  type: "stop"
}

type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
  | {
      type: "sqlite"
      progress:
        | {
            type: "InProgress"
            value: number
          }
        | {
            type: "Done"
          }
    }
  | {
      type: "ready"
    }
  | {
      type: "stopped"
    }
  | {
      type: "error"
      error: {
        message: string
        stack?: string
      }
    }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

const parentPort = getParentPort()

let listener: Listener | undefined

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)

  if (!command) {
    return
  }

  if (command.type === "stop") {
    void stop().catch(handleFatalError)
    return
  }

  void start(command).catch(handleFatalError)
})

async function start(command: StartCommand): Promise<void> {
  prepareSidecarEnv(command.password, command.userDataPath)

  ensureLoopbackNoProxy()
  useSystemCertificates()
  useEnvProxy()

  /*
   * 必须在 prepareSidecarEnv() 之后加载。
   *
   * OpenCode 的 Global.Path 和数据库路径会在模块加载期间根据
   * XDG_DATA_HOME、XDG_STATE_HOME、OPENCODE_DB 等变量计算。
   */
  const { Database, JsonMigration, Log, Server } =
    await import("virtual:opencode-server")

  await Log.init({
    level: "WARN",
  })

  if (command.needsMigration) {
    await JsonMigration.run(
      drizzle({
        client: Database.Client().$client,
      }),
      {
        progress: (event: {
          current: number
          total: number
        }) => {
          parentPort.postMessage({
            type: "sqlite",
            progress: {
              type: "InProgress",
              value:
                event.total === 0
                  ? 100
                  : Math.round(
                      (event.current / event.total) * 100,
                    ),
            },
          })
        },
      },
    )

    parentPort.postMessage({
      type: "sqlite",
      progress: {
        type: "Done",
      },
    })
  }

  listener = await Server.listen({
    port: command.port,
    hostname: command.hostname,
    username: "opencode",
    password: command.password,
    cors: ["oc://renderer"],
  })

  parentPort.postMessage({
    type: "ready",
  })
}

async function stop(): Promise<void> {
  try {
    await listener?.stop()
  } finally {
    listener = undefined

    parentPort.postMessage({
      type: "stopped",
    })

    setImmediate(() => {
      process.exit(0)
    })
  }
}

/**
 * 将 OpenCode 的全部本地文件限制在 Electron userData 目录。
 *
 * macOS 示例：
 * ~/Library/Application Support/Octo Agent/
 */
function prepareSidecarEnv(
  password: string,
  userDataPath: string,
): void {
  const opencodeRoot = join(userDataPath, "opencode")
  const dataHome = join(userDataPath, "xdg-data")
  const stateHome = join(userDataPath, "xdg-state")
  const cacheHome = join(userDataPath, "xdg-cache")
  const configHome = join(userDataPath, "xdg-config")
  const databasePath = join(opencodeRoot, "opencode.db")

  const directories = [
    userDataPath,
    opencodeRoot,
    dataHome,
    stateHome,
    cacheHome,
    configHome,
  ]

  for (const directory of directories) {
    mkdirSync(directory, {
      recursive: true,
      mode: 0o700,
    })
  }

  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,

    /*
     * 使用绝对路径，避免数据库落到：
     * ~/.local/share/opencode
     * /Applications
     * app.asar
     * 或不可写的 cwd。
     */
    OPENCODE_DB: databasePath,

    /*
     * 不使用 ?? 保留外部 XDG 路径，桌面应用应该使用自己独立、
     * 确定且可写的数据目录。
     */
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
  })

  console.log("[sidecar] userDataPath:", userDataPath)
  console.log("[sidecar] databasePath:", databasePath)
  console.log("[sidecar] XDG_DATA_HOME:", dataHome)
}

function ensureLoopbackNoProxy(): void {
  const loopback = [
    "127.0.0.1",
    "localhost",
    "::1",
  ]

  const upsert = (key: string): void => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)

    for (const host of loopback) {
      if (
        items.some(
          (value) =>
            value.toLowerCase() === host.toLowerCase(),
        )
      ) {
        continue
      }

      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates(): void {
  try {
    const nodeTls =
      tls as NodeTlsWithSystemCertificates

    nodeTls.setDefaultCACertificates([
      ...new Set([
        ...nodeTls.getCACertificates("default"),
        ...nodeTls.getCACertificates("system"),
      ]),
    ])
  } catch (error) {
    console.warn(
      "failed to load system certificates",
      error,
    )
  }
}

function useEnvProxy(): void {
  try {
    ;(
      http as NodeHttpWithEnvProxy
    ).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn(
      "failed to load proxy environment",
      error,
    )
  }
}

function parseCommand(
  value: unknown,
): SidecarCommand | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const command = value as Partial<StartCommand | StopCommand>

  if (command.type === "stop") {
    return {
      type: "stop",
    }
  }

  if (command.type !== "start") {
    return undefined
  }

  if (typeof command.hostname !== "string") {
    return undefined
  }

  if (typeof command.port !== "number") {
    return undefined
  }

  if (typeof command.password !== "string") {
    return undefined
  }

  if (typeof command.userDataPath !== "string") {
    return undefined
  }

  if (typeof command.needsMigration !== "boolean") {
    return undefined
  }

  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    userDataPath: command.userDataPath,
    needsMigration: command.needsMigration,
  }
}

function handleFatalError(error: unknown): void {
  const serialized = serializeError(error)

  console.error(
    "[sidecar] fatal error:",
    serialized,
  )

  parentPort.postMessage({
    type: "error",
    error: serialized,
  })

  setImmediate(() => {
    process.exit(1)
  })
}

function serializeError(error: unknown): {
  message: string
  stack?: string
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    message: String(error),
  }
}

function getParentPort(): ParentPort {
  const port =
    process.parentPort as ParentPort | undefined

  if (!port) {
    throw new Error(
      "Sidecar parent port unavailable",
    )
  }

  return port
}

process.on(
  "unhandledRejection",
  (reason: unknown) => {
    handleFatalError(reason)
  },
)

process.on(
  "uncaughtException",
  (error: Error) => {
    handleFatalError(error)
  },
)