import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

export const SkillUsed = BusEvent.define(
  "skill.used",
  Schema.Struct({
    skillName: Schema.String,
  }),
)