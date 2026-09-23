import type { MakeGroup } from "@/hooks/use-make-groups"

// Pending-group store per namespace. When a new session is created from a group's
// context menu ("新建对话"), the session should be auto-assigned to that group.
// The sidebar sets the pending entry; the page's session-creation flow consumes it.
//
// The value is bound to the project directory it originated in so a pending entry
// from project A can't leak into project B after a project switch: consume rejects
// entries whose directory doesn't match the current one, and the provider clears
// stale entries when the directory changes.
const pendingGroups = new Map<string, { groupId: string; directory: string }>()

export function setPendingGroup(namespace: string, groupId: string, directory: string) {
  pendingGroups.set(namespace, { groupId, directory })
}

export function clearPendingGroup(namespace: string) {
  pendingGroups.delete(namespace)
}

// Drop a pending entry only if it was created in a different directory than the
// current one (used on project switch so a stale entry from project A doesn't
// survive into project B).
export function clearStalePendingGroup(namespace: string, directory: string) {
  const entry = pendingGroups.get(namespace)
  if (entry && entry.directory !== directory) pendingGroups.delete(namespace)
}

// One-shot consume: returns the pending group id for the namespace only when the
// entry was created in the same directory AND the group still exists in the
// current project's group list. Always deletes the entry (consume = one-shot),
// so a rejected/stale entry can't leak into a later session creation.
export function consumePendingGroup(namespace: string, directory: string, groups: MakeGroup[]): string | null {
  const entry = pendingGroups.get(namespace)
  pendingGroups.delete(namespace)
  if (!entry) return null
  if (entry.directory !== directory) return null
  if (!groups.some((g) => g.id === entry.groupId)) return null
  return entry.groupId
}
