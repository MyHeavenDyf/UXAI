const dir = process.env.OCTO_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.OCTO_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.OCTO_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.OCTO_E2E_MODEL ?? "octo/gpt-5-nano"
const parts = model.split("/")
const providerID = parts[0] ?? "octo"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const seed = async () => {
  const { WithInstance } = await import("../src/project/with-instance")
  const { Session } = await import("../src/session/session")
  const { MessageID, PartID } = await import("../src/session/schema")
  const { ModelID, ProviderID } = await import("../src/provider/schema")
  const { InstanceRuntime } = await import("../src/project/instance-runtime")
  const { AppRuntime } = await import("../src/effect/app-runtime")
  const { Effect } = await import("effect")

  try {
    await WithInstance.provide({
      directory: dir,
      fn: async () => {
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title })))

        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const message = {
          id: messageID,
          sessionID: session.id,
          role: "user" as const,
          time: { created: now },
          agent: "octo_ai",
          model: {
            providerID: ProviderID.make(providerID),
            modelID: ModelID.make(modelID),
          },
        }
        const part = {
          id: partID,
          sessionID: session.id,
          messageID,
          type: "text" as const,
          text,
          time: { start: now },
        }
        await AppRuntime.runPromise(
          Session.Service.use((svc) =>
            Effect.gen(function* () {
              yield* svc.updateMessage(message)
              yield* svc.updatePart(part)
            }),
          ),
        )
      },
    })
  } finally {
    await InstanceRuntime.disposeAllInstances().catch(() => {})
  }
}

await seed()
