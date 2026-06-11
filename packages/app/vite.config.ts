import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { octoMockPlugin } from "./mock/index.ts"

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

const mockProxy = process.env.MOCK_API === "false"
  ? {
      "/pipeline/rest.root/workflow": {
        target: "https://octo.hdesign.huawei.com",
        changeOrigin: true,
        secure: true,
      },
    }
  : undefined

export default defineConfig({
  plugins: [desktopPlugin, octoMockPlugin(), sentry] as any,
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
