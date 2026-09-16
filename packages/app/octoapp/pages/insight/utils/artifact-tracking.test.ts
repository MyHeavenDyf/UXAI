import { expect, test } from "bun:test"
import { legacyArtifactParts } from "./artifact-tracking"

test("per-origin ownership keeps legacy/diagnostic turns and excludes server-owned results", () => {
  const parts = [
    { id: "old", state: { metadata: {} } },
    { id: "diagnostic", state: { metadata: { octoArtifactOwner: "diagnostic" } } },
    { id: "new", state: { metadata: { octoArtifactOwner: "server" } } },
    { id: "old-task-polled-in-new-turn", state: { metadata: { octoArtifactOwner: "legacy" } } },
    { id: "server-task-polled-after-rollback", state: { metadata: { octoArtifactOwner: "server" } } },
  ]
  expect(legacyArtifactParts(parts).map((p) => p.id)).toEqual(["old", "diagnostic", "old-task-polled-in-new-turn"])
  expect(legacyArtifactParts(parts, [{ metadata: { octoArtifactOwner: "server" } }]).map((p) => p.id)).toEqual([
    "diagnostic",
    "old-task-polled-in-new-turn",
  ])
})
