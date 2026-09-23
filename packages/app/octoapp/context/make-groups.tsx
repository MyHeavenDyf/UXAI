import {
  createContext,
  createEffect,
  createSignal,
  on,
  useContext,
  type Accessor,
  type ParentProps,
  type Setter,
} from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useMakeGroups, type MakeGroup } from "@/hooks/use-make-groups"
import { useSessionGroups, type SessionGroupMapping } from "@/hooks/use-session-groups"
import {
  setPendingGroup,
  consumePendingGroup,
  clearPendingGroup,
  clearStalePendingGroup,
} from "./pending-group"
export { setPendingGroup, consumePendingGroup, clearPendingGroup }

/**
 * Shared groups + session-group mapping state for the "make" namespace.
 *
 * Both the left sidebar (`GroupedSidebar` → `AgentSidebar`) and the design page
 * header kebab menu consume this single store so that optimistic updates (move /
 * remove / create group) stay in sync across the two UI surfaces.
 *
 * Provided by `MakeSidebarLayout`; only available within the make route tree.
 */
export type MakeGroupsContextValue = {
  namespace: string
  groups: MakeGroup[]
  addGroup: (name: string) => Promise<string | undefined>
  renameGroup: (id: string, name: string) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  moveGroup: (sourceId: string, targetId: string, position: "before" | "after") => Promise<void>
  mapping: SessionGroupMapping
  moveSessionToGroup: (sessionId: string, groupId: string, position?: number) => Promise<void>
  removeSessionFromGroup: (sessionId: string) => Promise<void>
  clearGroup: (groupId: string) => void
  reorderGroupSessions: (groupId: string, sessionIds: string[]) => Promise<void>
  sessionIdsOfGroup: (groupId: string) => string[]
  /** Expanded-group set (shared between sidebar + header kebab so the header's
   *  "移动到分组" can expand the target group in the sidebar). Module-level
   *  singleton per namespace → survives navigation. */
  expandedGroups: Accessor<Set<string>>
  setExpandedGroups: Setter<Set<string>>
  expandGroup: (groupId: string) => void
}

const MakeGroupsContext = createContext<MakeGroupsContextValue>()

export function useMakeGroupsContext(): MakeGroupsContextValue | undefined {
  return useContext(MakeGroupsContext)
}

// Module-level singleton expanded-groups signal per namespace. Persists across
// navigation (provider unmount/remount) and is shared by the sidebar and the
// header kebab so either can expand a group the other renders.
const expandedGroupSignals = new Map<string, [Accessor<Set<string>>, Setter<Set<string>>]>()
function getExpandedGroupsSignal(namespace: string): [Accessor<Set<string>>, Setter<Set<string>>] {
  let s = expandedGroupSignals.get(namespace)
  if (!s) {
    s = createSignal<Set<string>>(new Set())
    expandedGroupSignals.set(namespace, s)
  }
  return s
}

export function MakeGroupsProvider(props: ParentProps<{ namespace?: string }>) {
  const namespace = props.namespace ?? "make"
  const projectDir = useProjectDir()
  const globalSync = useGlobalSync()

  // Mirror GroupedSidebar's resolved-dir derivation so the fetch trigger is
  // identical to what the sidebar previously used.
  const [resolvedDir, setResolvedDir] = createSignal<string | undefined>()

  // Register the hooks BEFORE the dir-resolving effects. The hooks create
  // `on(dir, ..., { defer: true })` effects that must track dir()=undefined
  // on their first run; if the dir effects ran first and set resolvedDir to
  // a value, the deferred callbacks would never fire (no subsequent change
  // to trigger them), and groups/mappings would never load after restart.
  const mg = useMakeGroups(() => resolvedDir(), namespace)
  const sg = useSessionGroups(() => resolvedDir(), namespace)

  createEffect(() => {
    const d = projectDir()
    if (d) setResolvedDir(d)
  })
  createEffect(() => {
    if (!globalSync.data.ready) {
      const d = projectDir()
      if (d) setResolvedDir(d)
    }
  })

  // Drop a stale pending-group entry when the active project directory changes
  // (e.g. switching from project A to B). The entry is bound to its origin
  // directory; once that no longer matches the current directory it must not
  // survive into the new project's session-creation flow.
  createEffect(on(resolvedDir, (dir) => {
    if (dir === undefined) return
    clearStalePendingGroup(namespace, dir)
  }, { defer: true }))

  const [expandedGroups, setExpandedGroups] = getExpandedGroupsSignal(namespace)
  const expandGroup = (groupId: string) =>
    setExpandedGroups((prev) => {
      if (prev.has(groupId)) return prev
      const next = new Set(prev)
      next.add(groupId)
      return next
    })

  const value: MakeGroupsContextValue = {
    namespace,
    groups: mg.groups,
    addGroup: mg.addGroup,
    renameGroup: mg.renameGroup,
    removeGroup: mg.removeGroup,
    moveGroup: mg.moveGroup,
    mapping: sg.mapping,
    moveSessionToGroup: sg.moveSessionToGroup,
    removeSessionFromGroup: sg.removeSessionFromGroup,
    clearGroup: sg.clearGroup,
    reorderGroupSessions: sg.reorderGroupSessions,
    sessionIdsOfGroup: sg.sessionIdsOfGroup,
    expandedGroups,
    setExpandedGroups,
    expandGroup,
  }

  return <MakeGroupsContext.Provider value={value}>{props.children}</MakeGroupsContext.Provider>
}
