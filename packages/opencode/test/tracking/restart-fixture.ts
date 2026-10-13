process.env.OPENCODE_DB = process.argv[3]
process.env.OCTO_REPORT_BASE_URL = process.argv[4]
process.env.OCTO_ARTIFACT_SUCCESS = "http-2xx"
const { Database } = await import("../../src/storage/db")
const { ArtifactEventTable: Events } = await import("../../src/tracking/delivery.sql")
if (process.argv[2] === "seed") {
  Database.use((db) =>
    db
      .insert(Events)
      .values({
        id: "restart-event",
        message_id: "old-turn",
        part_id: "old-part",
        name: "artifact-file-write",
        payload: { datas: [{ name: "artifact-file-write" }] },
        created_at: Date.now() - 45 * 86_400_000,
        next_at: 0,
      })
      .run(),
  )
  Database.close()
  process.exit(0)
}
const { Server } = await import("../../src/server/server")
const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
for (let i = 0; i < 100; i++) {
  if (Database.use((db) => db.select().from(Events).get())?.state === "sent") {
    await listener.stop(true)
    Database.close()
    process.exit(0)
  }
  await Bun.sleep(100)
}
process.exit(1)
