import { expect, test } from "bun:test"
import * as Database from "@/storage/db"
import { eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
import { ModelID, ProviderID } from "@/provider/schema"
import { Identifier } from "@/id/id"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { cancelGeneration, getGeneration } from "@/studio/studio-service"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

test("cancels a creating generation without a provider task and persists the cancelled turn", async () => {
  await using directory = await tmpdir()
  await provideTestInstance({
    directory: directory.path,
    fn: async () => {
      const now = Date.now()
      const sessionID = SessionID.descending()
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const generationID = Identifier.create("studio_gen", "ascending")
      const message = {
        role: "assistant",
        parentID: MessageID.ascending(),
        modelID: ModelID.make("test"),
        providerID: ProviderID.make("test"),
        mode: "octo_studio",
        agent: "octo_studio",
        path: { cwd: Instance.directory, root: Instance.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now },
      } satisfies Omit<MessageV2.Assistant, "id" | "sessionID">
      const part = {
        type: "tool",
        callID: generationID,
        tool: "internel_image_generate",
        state: {
          status: "running",
          input: {},
          title: "图片生成",
          metadata: { studio: { generationID, status: "creating", progress: 0 } },
          time: { start: now },
        },
      } satisfies Omit<MessageV2.ToolPart, "id" | "sessionID" | "messageID">
      Database.use((db) => {
        db.insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Instance.project.id,
            slug: sessionID,
            directory: Instance.directory,
            title: "Studio creation cancellation",
            version: "test",
            agent: "octo_studio",
            time_created: now,
            time_updated: now,
          })
          .run()
        db.insert(MessageTable)
          .values({
            id: messageID,
            session_id: sessionID,
            time_created: now,
            time_updated: now,
            data: message,
          })
          .run()
        db.insert(PartTable)
          .values({
            id: partID,
            message_id: messageID,
            session_id: sessionID,
            time_created: now,
            time_updated: now,
            data: part,
          })
          .run()
        db.insert(StudioGenerationTable)
          .values({
            id: generationID,
            session_id: sessionID,
            directory: Instance.directory,
            assistant_message_id: messageID,
            tool_part_id: partID,
            provider: "internel",
            capability: "image.generate",
            status: "creating",
            progress: 0,
            request: { input: { prompt: "test", capability: "image.generate" } },
            next_poll_at: Number.MAX_SAFE_INTEGER,
            time_created: now,
            time_updated: now,
          })
          .run()
      })
      expect((await getGeneration(generationID)).status).toBe("creating")
      const cancelled = await cancelGeneration(generationID)
      expect(cancelled.status).toBe("create_failed")
      expect(cancelled.rawStatus).toBe("4")
      expect(cancelled.error).toBe("用户取消生成")
      expect(cancelled.taskId).toBeUndefined()
      const cancelledPart = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, partID)).get())
      expect(cancelledPart?.data).toMatchObject({
        state: {
          status: "error",
          error: "用户取消生成",
          metadata: { studio: { status: "create_failed", rawStatus: 4 } },
        },
      })
      expect((await cancelGeneration(generationID)).status).toBe("create_failed")
      Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run())
    },
  })
})
