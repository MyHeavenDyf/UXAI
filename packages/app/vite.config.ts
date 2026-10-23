import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { octoMockPlugin } from "./mock/index.ts"
import { sharePagePlugin } from "./share-page-plugin.ts"

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
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

const octoBaseUrl = process.env.VITE_OCTO_BASE_URL

// share 页面同源调用的接口,生产由 nginx 同源转发,dev 下需代理到真实后端。
// 独立于 MOCK_API:share 是真实功能,不应被 mock 开关阻断;只要 VITE_OCTO_BASE_URL 有值就启用。
const shareProxy = octoBaseUrl
  ? {
      "/main/rest.root/octoAgentServer/agentSession/getShareSessionInfo": {
        target: octoBaseUrl,
        changeOrigin: true,
        secure: true,
      },
      "/tool": {
        target: octoBaseUrl,
        changeOrigin: true,
        secure: true,
      },
    }
  : undefined

const mockProxy = process.env.MOCK_API === "false"
  ? {
      "/pipeline/rest.root/workflow": {
        target: octoBaseUrl,
        changeOrigin: true,
        secure: true,
      },
      ...shareProxy,
    }
  : shareProxy

export default defineConfig({
  plugins: [desktopPlugin, octoMockPlugin(), sharePagePlugin(), sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    historyApiFallback: true,
    proxy: mockProxy,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
