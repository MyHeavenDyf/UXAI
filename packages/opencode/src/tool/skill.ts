import path from "path"
import { Effect, Schema } from "effect"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill.get(params.name)
          if (!info) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          // Fire-and-forget: publish skill.used event to GlobalBus for frontend consumption
          import("@/bus").then((Bus) => {
            Bus.publish(Skill.SkillUsed, { skillName: info.name })
          })

          const dir = path.dirname(info.location)
          const files = yield* skill.files(info, { signal: ctx.abort })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              Skill.formatLoaded(info, files),
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
