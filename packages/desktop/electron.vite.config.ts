import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import { loadEnv } from "vite"
import appPlugin from "@opencode-ai/app/vite"
import { octoMockPlugin } from "../app/mock/index.ts"
import * as fs from "node:fs/promises"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

// jk-j60099994-replace-with-electron-vite-config-1-start
// jk-j60099994-replace-with-electron-vite-config-1-end

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const channel = (() => {
    const raw = env.OCTO_CHANNEL ?? process.env.OCTO_CHANNEL
    if (raw === "dev" || raw === "beta" || raw === "prod") return raw
    return "dev"
  })()

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
        // 把业务接口 base 注入 main(供 sidecar 桥接给 server 侧工具,如 knowledge_search)。
        "import.meta.env.VITE_OCTO_BASE_URL": JSON.stringify(env.VITE_OCTO_BASE_URL ?? ""),
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
      plugins: [appPlugin, octoMockPlugin(), sentry],
      publicDir: "../../../app/public",
      root: "src/renderer",
      define: {
        "import.meta.env.VITE_OCTO_CHANNEL": JSON.stringify(channel),
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
