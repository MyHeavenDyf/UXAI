import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"

const app = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)
const octoConfig = path.join(xdgConfig!, "octo")

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  octoConfig,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

// 逐目录容错:这里曾是无 catch 的 Promise.all,任一目录建不出来(EACCES 等)会让
// 模块求值直接失败,桌面端 sidecar(utility process)无错误上报地被打死(exit 1)。
// config 类目录缺失时 config 加载天然容错(读不到即忽略);data 类目录缺失的后果
// 由 DB 打开错误兜底(桌面端 shouldRetryWithAppDataFallback 重试链路)。保持原有
// 顺序与并行度,仅加逐项 catch。
await Promise.all(
  [Path.data, Path.config, Path.octoConfig, Path.state, Path.tmp, Path.log, Path.bin].map(async (dir) => {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (error) {
      console.warn(`[global] mkdir failed: ${dir} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }),
)

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly octoConfig: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    octoConfig: Path.octoConfig,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    ...input,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
