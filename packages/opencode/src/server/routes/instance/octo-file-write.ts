import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"
import { AppRuntime } from "@/effect/app-runtime"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"

/**
 * Octo: 文件写入 API
 * 用于 make 页面 HTML 编辑器保存内容到本地文件
 */
export const OctoFileWriteRoute = lazy(() =>
  new Hono().put(
    "/content",
    describeRoute({
      summary: "Write file content",
      description: "Write content to a specified file path.",
      operationId: "file.write",
      responses: {
        200: {
          description: "Write result",
          content: {
            "application/json": {
              schema: resolver(z.object({ ok: z.boolean(), error: z.string().optional() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    ),
    async (c) => {
      const { path, content } = c.req.valid("json")
      try {
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const fs = yield* AppFileSystem.Service
            yield* fs.writeWithDirs(path, content)
          }),
        )
        return c.json({ ok: true })
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  ),
)
