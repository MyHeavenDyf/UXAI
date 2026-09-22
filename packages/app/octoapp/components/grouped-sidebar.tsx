import { createEffect, createSignal, Show, For, on } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useMakeGroups, type MakeGroup } from "@/hooks/use-make-groups"
import { useSessionGroups } from "@/hooks/use-session-groups"
import { useMakeGroupsContext, setPendingGroup } from "@/context/make-groups"
import { AgentSidebar, type AgentSidebarProps, type BeforeSectionApi } from "@/components/agent-sidebar"
import { SidebarSectionHeader } from "@/components/sidebar-shell"
import { SessionList, ScrollableText } from "@/components/session-list"
import { DialogCreateGroup } from "@/components/dialog-create-group"
import { DialogRemoveGroup } from "@/components/dialog-remove-group"
import { IconTableEllipsis } from "@/pages/make/icons/design-files-icons"
import { tracker } from "@/utils/tracker"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import trashPng from "@/pages/_shell/icons/trash.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import folderLinePng from "@/pages/_shell/icons/Folder_line.png"
import folderLineClosePng from "@/pages/_shell/icons/Folder_line_close.png"
import folderOpenedPng from "@/pages/_shell/icons/ic_bpit_floder_opened.png"

export type GroupedSidebarProps = Omit<
  AgentSidebarProps,
  "directory" | "activeSessionId" | "groups" | "sessionGroupMapping" |
  "onMoveToGroup" | "onRemoveFromGroup" | "onCreateGroupForSession" | "onReorderGroupSessions" | "onSessionClick" | "beforeSection"
> & {
  /** Namespace for group DB queries (e.g. "make", "insight") */
  namespace: string
  /** Route prefix for extracting active session ID from URL (e.g. "/make", "/insight") */
  routePrefix: string
}

const groupExpandedByNamespace = new Map<string, boolean>()
const expandedGroupsByNamespace = new Map<string, Set<string>>()

export function GroupedSidebar(props: GroupedSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const projectDir = useProjectDir()
  const dialog = useDialog()

  const [resolvedDir, setResolvedDir] = createSignal<string>()
  const [recentCollapsed, setRecentCollapsed] = createSignal(false)
  const [groupExpanded, setGroupExpanded] = createSignal(groupExpandedByNamespace.get(props.namespace) ?? false)
  createEffect(() => groupExpandedByNamespace.set(props.namespace, groupExpanded()))
  const [selectedGroupId, setSelectedGroupId] = createSignal<string | null>(null)
  const [hoveredId, setHoveredId] = createSignal<string | null>(null)
  const [menuOpenId, setMenuOpenId] = createSignal<string | null>(null)
  const [removeTarget, setRemoveTarget] = createSignal<MakeGroup | null>(null)
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [dragOverId, setDragOverId] = createSignal<string | null>(null)
  const [dropPosition, setDropPosition] = createSignal<"before" | "after">("before")
  const [sessionDragOverGroup, setSessionDragOverGroup] = createSignal<string | null>(null)
  let sectionApi: BeforeSectionApi | undefined
  // Reuse the shared MakeGroupsContext store when one is provided for this
  // namespace (make/insight routes both wrap their tree in MakeGroupsProvider),
  // so optimistic group/mapping updates stay in sync with the header kebab
  // menus. If no provider is present, fall back to local hook instances.
  const sharedGroupsCtx = useMakeGroupsContext()
  const shared = sharedGroupsCtx && sharedGroupsCtx.namespace === props.namespace ? sharedGroupsCtx : undefined
  const { groups, addGroup, renameGroup, removeGroup, moveGroup } = shared ?? useMakeGroups(() => resolvedDir(), props.namespace)
  const { mapping: sessionGroupMapping, moveSessionToGroup, removeSessionFromGroup, clearGroup, reorderGroupSessions } = shared ?? useSessionGroups(() => resolvedDir(), props.namespace)

  // Expanded-group set: shared (module-level singleton) when a provider is
  // present so the header kebab's "移动到分组" can expand the target group in
  // the sidebar; otherwise a local signal persisted to the module Map.
  const [localExpandedGroups, setLocalExpandedGroups] = createSignal<Set<string>>(new Set(expandedGroupsByNamespace.get(props.namespace)))
  createEffect(() => { if (!shared) expandedGroupsByNamespace.set(props.namespace, localExpandedGroups()) })
  const expandedGroups = shared?.expandedGroups ?? localExpandedGroups
  const setExpandedGroups = shared?.setExpandedGroups ?? setLocalExpandedGroups

  const toggleGroup = (id: string) => {
    tracker.interaction({ module: props.trackerModule ?? "session", name: "toggle-group" })
    if (expandedGroups().has(id)) {
      setExpandedGroups(prev => { const next = new Set(prev); next.delete(id); return next })
      if (selectedGroupId() === id) setSelectedGroupId(null)
    } else {
      setExpandedGroups(prev => { const next = new Set(prev); next.add(id); return next })
      const activeSid = rawActiveSessionId()
      setSelectedGroupId(activeSid && sessionGroupMapping[activeSid]?.groupId === id ? null : id)
    }
  }

  const handleRenameGroup = (group: MakeGroup) => {
    tracker.interaction({ module: props.trackerModule ?? "session", name: "rename-group" })
    dialog.show(() => (
      <DialogCreateGroup
        title="编辑对话分组"
        actionLabel="创建分组"
        initialName={group.name}
        existingNames={groups.map(g => g.name)}
        onCreate={(name) => renameGroup(group.id, name)}
      />
    ))
  }

  const handleRemoveGroup = (group: MakeGroup) => {
    tracker.interaction({ module: props.trackerModule ?? "session", name: "remove-group" })
    setRemoveTarget(group)
  }

  const handleNewSessionInGroup = (group: MakeGroup) => {
    tracker.interaction({ module: props.trackerModule ?? "session", name: "new-session-in-group" })
    setPendingGroup(props.namespace, group.id)
    setExpandedGroups(prev => { const next = new Set(prev); next.add(group.id); return next })
    shared?.expandGroup(group.id)
    navigate(props.buildNewRoute())
  }

  const getGroupSessions = (groupId: string) => {
    const api = sectionApi
    if (!api) return []
    const filtered = api.sessions.filter(s => sessionGroupMapping[s.id]?.groupId === groupId && !api.isPinned(s))
    return filtered.sort((a, b) => (sessionGroupMapping[a.id]?.position ?? 0) - (sessionGroupMapping[b.id]?.position ?? 0))
  }

  const reorderGroupSession = async (groupId: string, sourceId: string, targetId: string, position: "before" | "after") => {
    const sessions = getGroupSessions(groupId)
    const ids = sessions.map(s => s.id).filter(id => id !== sourceId)
    const targetIdx = ids.indexOf(targetId)
    if (targetIdx === -1) ids.push(sourceId)
    else ids.splice(position === "before" ? targetIdx : targetIdx + 1, 0, sourceId)
    await reorderGroupSessions(groupId, ids)
  }

  const rawActiveSessionId = () => {
    const m = location.pathname.match(new RegExp(`^${props.routePrefix}/(.+)$`))
    return m?.[1]
  }
  const activeSessionId = () => (selectedGroupId() ? undefined : rawActiveSessionId())

  createEffect(on(rawActiveSessionId, (sid) => {
    if (sid) setSelectedGroupId(null)
  }, { defer: true }))

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

  return (
    <>
    <AgentSidebar
      {...props}
      directory={resolvedDir()}
      activeSessionId={activeSessionId}
      onSessionClick={() => setSelectedGroupId(null)}
      groups={groups}
      sessionGroupMapping={sessionGroupMapping}
      onMoveToGroup={(session, groupId) => {
        const p = moveSessionToGroup(session.id, groupId)
        setExpandedGroups(prev => { const next = new Set(prev); next.add(groupId); return next })
        return p
      }}
      onRemoveFromGroup={(session) => removeSessionFromGroup(session.id)}
      onCreateGroupForSession={(session) => dialog.show(() => (
        <DialogCreateGroup
          existingNames={groups.map(g => g.name)}
          onCreate={async (name) => {
            const id = await addGroup(name)
            if (id) {
              await moveSessionToGroup(session.id, id)
              setExpandedGroups(prev => { const next = new Set(prev); next.add(id); return next })
            }
          }}
        />
      ))}
      onReorderGroupSessions={(groupId, sourceId, targetId, position) => reorderGroupSession(groupId, sourceId, targetId, position)}
      beforeSection={(api) => {
        sectionApi = api
        return (
        <>
          <SidebarSectionHeader
            title="分组"
            class="section-header-inline"
            collapsed={recentCollapsed()}
            onToggleCollapse={() => { tracker.interaction({ module: props.trackerModule ?? "session", name: "toggle-group-section" }); setRecentCollapsed(v => !v) }}
            actionIcon={() => (
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M10.6167 9.38336L10.6167 2.50003C10.6167 2.32781 10.5583 2.18058 10.4417 2.05836C10.3194 1.9417 10.1722 1.88336 10 1.88336C9.82777 1.88336 9.68055 1.9417 9.55833 2.05836C9.44166 2.18058 9.38333 2.32781 9.38333 2.50003L9.38333 9.38336L2.5 9.38336C2.32778 9.38336 2.18055 9.44169 2.05833 9.55836C1.94166 9.68058 1.88333 9.8278 1.88333 10C1.88333 10.1722 1.94166 10.3195 2.05833 10.4417C2.18055 10.5584 2.32778 10.6167 2.5 10.6167L9.38333 10.6167L9.38333 17.5C9.38333 17.6722 9.44166 17.8195 9.55833 17.9417C9.68055 18.0584 9.82777 18.1167 10 18.1167C10.1722 18.1167 10.3194 18.0584 10.4417 17.9417C10.5583 17.8195 10.6167 17.6722 10.6167 17.5L10.6167 10.6167L17.5 10.6167C17.6722 10.6167 17.8194 10.5584 17.9417 10.4417C18.0583 10.3195 18.1167 10.1722 18.1167 10C18.1167 9.8278 18.0583 9.68058 17.9417 9.55836C17.8194 9.44169 17.6722 9.38336 17.5 9.38336L10.6167 9.38336Z" fill="#777777" fill-rule="nonzero" />
              </svg>
            )}
            onAction={() => { tracker.interaction({ module: props.trackerModule ?? "session", name: "create-group" }); dialog.show(() => <DialogCreateGroup existingNames={groups.map(g => g.name)} onCreate={addGroup} />) }}
          />
          <Show when={!recentCollapsed()}>
            <div class="flex flex-col" style={{ "flex-shrink": "0" }}>
              <Show
                when={groups.length}
                fallback={
                  <div class="flex items-center text-[12px] leading-[20px]" style={{ height: "36px", "padding-left": "12px", color: "var(--octo-text-secondary, #777777)" }}>
                    暂无对话分组
                  </div>
                }
              >
                <For each={groupExpanded() ? groups : groups.slice(0, 5)}>
                  {(group) => {
                    const isActive = () => selectedGroupId() === group.id
                    const showMenu = () => hoveredId() === group.id || menuOpenId() === group.id
                    return (
                    <>
                      <div
                        data-group-id={group.id}
                        class="group-item flex items-center gap-[8px] text-[12px] leading-[20px] h-[36px] shrink-0 relative rounded-[8px] transition-colors"
                        classList={{
                          "bg-[rgba(10,89,247,0.08)]": isActive(),
                          "hover:bg-surface-base-hover": true,
                          "bg-surface-base-hover": menuOpenId() === group.id && !isActive(),
                          "opacity-40": draggingId() === group.id,
                          "bg-[rgba(10,89,247,0.06)]": sessionDragOverGroup() === group.id && !isActive(),
                        }}
                        style={{
                          "padding-left": "12px",
                          "padding-right": showMenu() ? "28px" : (isActive() ? "12px" : "0"),
                          color: isActive() ? "#0A59F7" : "rgba(0,0,0,0.9)",
                        }}
                        draggable={true}
                        onDragStart={(e) => {
                          setDraggingId(group.id)
                          if (!e.dataTransfer) return
                          e.dataTransfer.effectAllowed = "move"
                          e.dataTransfer.setData("text/plain", group.id)
                        }}
                        onDragEnd={() => {
                          setDraggingId(null)
                          setDragOverId(null)
                          setSessionDragOverGroup(null)
                        }}
                        onDragOver={(e) => {
                          if (api.draggingSessionId()) {
                            e.preventDefault()
                            if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
                            setSessionDragOverGroup(group.id)
                          } else if (draggingId()) {
                            e.preventDefault()
                            if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
                            const rect = e.currentTarget.getBoundingClientRect()
                            setDragOverId(group.id)
                            setDropPosition(e.clientY - rect.top < rect.height / 2 ? "before" : "after")
                          }
                        }}
                        onDragLeave={(e) => {
                          const related = e.relatedTarget as Node | null
                          if (related && e.currentTarget.contains(related)) return
                          if (dragOverId() === group.id) setDragOverId(null)
                          if (sessionDragOverGroup() === group.id) setSessionDragOverGroup(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (api.draggingSessionId()) {
                            api.handleSessionDrop({ type: "group", groupId: group.id })
                          } else {
                            const sourceId = draggingId()
                            if (sourceId && sourceId !== group.id) {
                              tracker.interaction({ module: props.trackerModule ?? "session", name: "reorder-group" })
                              moveGroup(sourceId, group.id, dropPosition())
                            }
                          }
                          setDraggingId(null)
                          setDragOverId(null)
                          setSessionDragOverGroup(null)
                        }}
                        onMouseEnter={() => setHoveredId(group.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpenId(group.id) }}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <Show when={dragOverId() === group.id && draggingId() && draggingId() !== group.id}>
                          <div
                            class="absolute left-[8px] right-[8px] pointer-events-none"
                            style={{
                              height: "2px",
                              background: "#0A59F7",
                              "border-radius": "1px",
                              "z-index": "10",
                              top: dropPosition() === "before" ? "0" : undefined,
                              bottom: dropPosition() === "after" ? "0" : undefined,
                            }}
                          />
                        </Show>
                        <span style={{ width: "20px", height: "20px", display: "flex", "align-items": "center", "justify-content": "center", "flex-shrink": "0" }}>
                          <img src={isActive() ? folderOpenedPng : expandedGroups().has(group.id) ? folderLinePng : folderLineClosePng} style={{ width: "20px", height: "20px", "flex-shrink": "0" }} alt="" draggable={false} />
                        </span>
                        <ScrollableText text={group.name} hovered={hoveredId() === group.id} />
                        <Show when={isActive() && !showMenu()}>
                          <span
                            class="absolute right-[12px] top-1/2 rounded-full pointer-events-none"
                            style={{ height: "28px", width: "4px", background: "#0A59F7", transform: "translateY(-50%)" }}
                          />
                        </Show>
                        <DropdownMenu
                          gutter={4}
                          placement="bottom-end"
                          open={menuOpenId() === group.id}
                          onOpenChange={(open) => setMenuOpenId(open ? group.id : null)}
                        >
                          <div
                            class="absolute right-[4px] top-1/2 -translate-y-1/2 flex items-center justify-center"
                            style={{ width: "20px", height: "20px", opacity: showMenu() ? 1 : 0, "pointer-events": showMenu() ? "auto" : "none" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenu.Trigger
                              as="button"
                              class="flex items-center justify-center hover:bg-[rgba(0,0,0,0.06)]"
                              style={{ width: "20px", height: "20px", "border-radius": "4px", cursor: "pointer" }}
                            >
                              <IconTableEllipsis size={16} style={{ color: "rgba(0,0,0,0.6)" }} />
                            </DropdownMenu.Trigger>
                          </div>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content style={{ width: "175px", "min-height": "116px", padding: "4px", display: "flex", "flex-direction": "column", gap: "4px" }}>
                              <DropdownMenu.Item class="flex items-center gap-2" onSelect={() => handleNewSessionInGroup(group)}>
                                <Icon name="plus" size="small" style={{ width: "14px", height: "14px", "flex-shrink": "0", color: "rgba(0,0,0,0.6)" }} />
                                <DropdownMenu.ItemLabel>新建对话</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                              <DropdownMenu.Item class="flex items-center gap-2" onSelect={() => handleRenameGroup(group)}>
                                <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                                <DropdownMenu.ItemLabel>重命名</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                              <DropdownMenu.Item class="flex items-center gap-2" onSelect={() => handleRemoveGroup(group)}>
                                <img src={trashPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                                <DropdownMenu.ItemLabel>移除对话分组</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                      <Show when={expandedGroups().has(group.id)}>
                        <SessionList
                          sessions={getGroupSessions(group.id)}
                          activeSessionId={api.activeSessionId()}
                          stable={api.stable()}
                          emptyText="暂无对话"
                          hoverOnActive
                          onSessionClick={api.onSessionClick}
                          onSessionContextMenu={api.onSessionContextMenu}
                          onSessionActionClick={api.onSessionContextMenu}
                          isContextTarget={api.isContextTarget}
                          renamingId={api.renamingId()}
                          renameDraft={api.renameDraft()}
                          onRenameInput={api.onRenameInput}
                          onRenameSave={api.onRenameSave}
                          onRenameCancel={api.onRenameCancel}
                          itemsDraggable
                          draggingSessionId={api.draggingSessionId()}
                          dragOverSessionId={api.dragOverSessionId()}
                          sessionDropPosition={api.sessionDropPosition()}
                          onSessionDragStart={api.onSessionDragStart}
                          onSessionDragEnd={api.onSessionDragEnd}
                          onSessionDragOver={api.onSessionDragOver}
                          onSessionDragLeave={api.onSessionDragLeave}
                          onSessionDrop={(e, session) => { e.preventDefault(); api.handleSessionDrop({ type: "session", sessionId: session.id, position: api.sessionDropPosition() ?? "before", section: "group", groupId: group.id }) }}
                          onEmptyDrop={() => api.handleSessionDrop({ type: "group", groupId: group.id })}
                          plainEmptyDropZone
                        />
                      </Show>
                    </>
                    )
                  }}
                </For>
                <Show when={!groupExpanded() && groups.length > 5}>
                  <div class="flex items-center text-[12px] leading-[20px] cursor-pointer" style={{ height: "36px", "padding-left": "12px", color: "var(--octo-text-secondary, #777777)" }} onClick={() => setGroupExpanded(true)}>
                    查看更多
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </>
        )
      }}
    />
    <Show when={removeTarget()}>
      <Portal>
        <DialogRemoveGroup
          onCancel={() => setRemoveTarget(null)}
          onConfirm={async () => {
            const target = removeTarget()
            if (target) {
              clearGroup(target.id)
              await removeGroup(target.id)
              setExpandedGroups(prev => { const next = new Set(prev); next.delete(target.id); return next })
              if (selectedGroupId() === target.id) setSelectedGroupId(null)
            }
            setRemoveTarget(null)
          }}
        />
      </Portal>
    </Show>
    </>
  )
}
