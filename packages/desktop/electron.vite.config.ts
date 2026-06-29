import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import { loadEnv } from "vite"
import appPlugin from "@opencode-ai/app/vite"
import { octoMockPlugin } from "../app/mock/index.ts"
import * as fs from "node:fs/promises"
import { readFileSync } from "node:fs"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

// jk-j60099994-replace-with-electron-vite-config-1-start
// jk-j60099994-replace-with-electron-vite-config-1-end

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const channel = (() => {
    const raw = env.OCTO_CHANNEL ?? process.env.OCTO_CHANNEL
    if (raw === "dev" || raw === "beta" || raw === "prod") return raw
    return "dev"
  })()

  // [octo:env] 以 .env.example 声明的业务变量(OCTO_*/VITE_*)为清单,逐个打印**实际生效值**
  // (loadEnv 结果,优先级 process.env > .env.<mode> > .env;未配置标 (未设置))。这样 dev/build 都能
  // 看到完整业务变量清单 + 各自当前值,直接确认"连 beta 还是 prod",不必猜哪个 .env 文件生效。
  // 以 .env.example 为单一真相源(新增变量自动纳入);只列业务变量,不打整个 process.env(系统变量 + 密钥)。
  const declaredKeys = (() => {
    try {
      return readFileSync(".env.example", "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => l.slice(0, l.indexOf("=")).trim())
        .filter((k) => k.startsWith("OCTO_") || k.startsWith("VITE_"))
    } catch {
      // 读不到 .env.example 时回退:只列 env 里实际存在的 OCTO_/VITE_ 变量。
      return Object.keys(env)
        .filter((k) => k.startsWith("OCTO_") || k.startsWith("VITE_"))
        .sort()
    }
  })()
  const logOctoEnv = () => {
    // 多行 banner + 前后空行,dev 时即使被 electron 启动日志夹住也好辨认 / 好 grep(搜 octo:env)。
    const lines = [
      "",
      `[octo:env] ┌─ effective env  mode=${mode}  channel=${channel}  command=${command}  (${declaredKeys.length} keys)`,
      ...declaredKeys.map((k) => `[octo:env] │  ${k}=${env[k] || "(未设置)"}`),
      "[octo:env] └─ 值=process.env > .env.<mode> > .env 覆盖后的最终生效;清单来自 .env.example",
      "",
    ]
    console.log(lines.join("\n"))
  }
  // build:此刻打印即稳定可见。dev(serve):vite dev server 启动会 clearScreen 清屏,此处打会被刷掉,
  // 故 dev 改由下面 octoEnvDebugPlugin 在 server listening 之后补打,保证 run dev 也能看到。
  if (command === "build") logOctoEnv()
  const octoEnvDebugPlugin = {
    name: "octo:env-debug",
    apply: "serve" as const,
    configureServer(server: { httpServer: { once(e: string, cb: () => void): void } | null }) {
      // 延到下一个 tick,确保排在 vite 打印 server url(含 clearScreen)之后,不被清屏吞掉。
      server.httpServer?.once("listening", () => setTimeout(logOctoEnv, 0))
    },
  }

  const sentry =
    process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          telemetry: false,
          release: {
            name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
          },
          sourcemaps: {
            assets: "./out/renderer/**",
            filesToDeleteAfterUpload: "./out/renderer/**/*.map",
          },
        })
      : false

  return {
    main: {
      define: {
        "import.meta.env.OCTO_CHANNEL": JSON.stringify(channel),
        // 渲染进程需要 VITE_OCTO_BASE_URL 判断是否走 IPC; main 进程 mock.ts/windows.ts 也读此值
        "import.meta.env.VITE_OCTO_BASE_URL": JSON.stringify(env.VITE_OCTO_BASE_URL ?? ""),
        // main 进程 mock.ts mockEnabled() 检查 import.meta.env.MOCK_API 判断是否启用 mock
        "import.meta.env.MOCK_API": JSON.stringify(env.MOCK_API ?? ""),
        // 内网知识库 base:独立变量(不复用 VITE_OCTO_BASE_URL,避免与渠道默认值耦合)。
        // 由 .env[.beta/.prod] 的 OCTO_KB_BASE_URL 提供,经 createSidecarEnv 注入 sidecar 供 knowledge_search 读。
        "import.meta.env.OCTO_KB_BASE_URL": JSON.stringify(env.OCTO_KB_BASE_URL ?? ""),
        // Insight uxr-tool MCP server 地址:由 .env[.beta/.prod] 的 OCTO_UXR_MCP_URL 提供,
        // 经 createSidecarEnv 注入 sidecar 供 builtin-mcp 读;留空则 sidecar 回落代码内默认 beta IP。
        "import.meta.env.OCTO_UXR_MCP_URL": JSON.stringify(env.OCTO_UXR_MCP_URL ?? ""),
      },
      build: {
        rollupOptions: {
          input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
        },
        externalizeDeps: { include: [nodePtyPkg] },
      },
      plugins: [
        {
          name: "opencode:node-pty-narrower",
          enforce: "pre",
          resolveId(s) {
            if (s === "@lydell/node-pty") return nodePtyPkg
          },
        },
        {
          name: "opencode:virtual-server-module",
          enforce: "pre",
          resolveId(id) {
            if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
          },
        },
        {
          name: "opencode:copy-server-assets",
          async writeBundle() {
            for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
              if (!l.endsWith(".wasm")) continue
              await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
            }
          },
        },
      ],
    },
    preload: {
      build: {
        rollupOptions: {
          input: { index: "src/preload/index.ts" },
          output: {
            format: "cjs",
            entryFileNames: "[name].js",
          },
        },
      },
    },
    renderer: {
      plugins: [appPlugin, octoMockPlugin(), sentry, octoEnvDebugPlugin],
      publicDir: "../../../app/public",
      root: "src/renderer",
      define: {
        "import.meta.env.VITE_OCTO_CHANNEL": JSON.stringify(channel),
        // 渲染进程 pipelineRequest.ts 读此值: 有值时走 IPC 调真实接口, 空值时走浏览器 fetch(外网 mock)
        "import.meta.env.VITE_OCTO_BASE_URL": JSON.stringify(env.VITE_OCTO_BASE_URL ?? ""),
        // jk-j60099994-replace-with-electron-vite-config-2-start
        // jk-j60099994-replace-with-electron-vite-config-2-end
      },
      build: {
        sourcemap: true,
        rollupOptions: {
          input: {
            main: "src/renderer/index.html",
            loading: "src/renderer/loading.html",
          },
        },
      },
    },
  }
})
