import { createEffect, createSignal, Show, For, on } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocation } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useMakeGroups, type MakeGroup } from "@/hooks/use-make-groups"
import { useSessionGroups } from "@/hooks/use-session-groups"
import { AgentSidebar, type AgentSidebarProps, type BeforeSectionApi } from "@/components/agent-sidebar"
import { SidebarSectionHeader } from "@/components/sidebar-shell"
import { SessionList } from "@/components/session-list"
import { DialogCreateGroup } from "@/components/dialog-create-group"
import { DialogRemoveGroup } from "@/components/dialog-remove-group"
import { IconTableEllipsis } from "@/pages/make/icons/design-files-icons"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import trashPng from "@/pages/_shell/icons/trash.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import folderLinePng from "@/pages/_shell/icons/Folder_line.png"
import folderLineClosePng from "@/pages/_shell/icons/Folder_line_close.png"

export type GroupedSidebarProps = Omit<
  AgentSidebarProps,
  "directory" | "activeSessionId" | "groups" | "sessionGroupMapping" |
  "onMoveToGroup" | "onRemoveFromGroup" | "onCreateGroupForSession" | "beforeSection"
> & {
  /** Namespace for group localStorage keys (e.g. "make", "insight") */
  namespace: string
  /** Route prefix for extracting active session ID from URL (e.g. "/make", "/insight") */
  routePrefix: string
}

export function GroupedSidebar(props: GroupedSidebarProps) {
  const location = useLocation()
  const globalSync = useGlobalSync()
  const projectDir = useProjectDir()
  const dialog = useDialog()

  const [resolvedDir, setResolvedDir] = createSignal<string>()
  const [recentCollapsed, setRecentCollapsed] = createSignal(false)
  const [groupExpanded, setGroupExpanded] = createSignal(false)
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const [selectedGroupId, setSelectedGroupId] = createSignal<string | null>(null)
  const [hoveredId, setHoveredId] = createSignal<string | null>(null)
  const [menuOpenId, setMenuOpenId] = createSignal<string | null>(null)
  const [removeTarget, setRemoveTarget] = createSignal<MakeGroup | null>(null)
  let sectionApi: BeforeSectionApi | undefined
  const { groups, addGroup, renameGroup, removeGroup } = useMakeGroups(() => resolvedDir(), props.namespace)
  const { mapping: sessionGroupMapping, moveSessionToGroup, removeSessionFromGroup, clearGroup } = useSessionGroups(() => resolvedDir(), props.namespace)

  const toggleGroup = (id: string) => {
    if (expandedGroups().has(id)) {
      setExpandedGroups(prev => { const next = new Set(prev); next.delete(id); return next })
      if (selectedGroupId() === id) setSelectedGroupId(null)
    } else {
      setExpandedGroups(prev => { const next = new Set(prev); next.add(id); return next })
      const activeSid = rawActiveSessionId()
      setSelectedGroupId(activeSid && sessionGroupMapping[activeSid] === id ? null : id)
    }
  }

  const handleRenameGroup = (group: MakeGroup) => {
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

  const handleRemoveGroup = (group: MakeGroup) => setRemoveTarget(group)

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
      groups={groups}
      sessionGroupMapping={sessionGroupMapping}
      onMoveToGroup={(session, groupId) => moveSessionToGroup(session.id, groupId)}
      onRemoveFromGroup={(session) => removeSessionFromGroup(session.id)}
      onCreateGroupForSession={(session) => dialog.show(() => (
        <DialogCreateGroup
          existingNames={groups.map(g => g.name)}
          onCreate={(name) => {
            const id = addGroup(name)
            if (id) {
              moveSessionToGroup(session.id, id)
              setExpandedGroups(prev => { const next = new Set(prev); next.add(id); return next })
            }
          }}
        />
      ))}
      beforeSection={(api) => {
        sectionApi = api
        return (
        <>
          <SidebarSectionHeader
            title="分组"
            class="section-header-inline"
            collapsed={recentCollapsed()}
            onToggleCollapse={() => setRecentCollapsed(v => !v)}
            actionIcon={() => (
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M10.6167 9.38336L10.6167 2.50003C10.6167 2.32781 10.5583 2.18058 10.4417 2.05836C10.3194 1.9417 10.1722 1.88336 10 1.88336C9.82777 1.88336 9.68055 1.9417 9.55833 2.05836C9.44166 2.18058 9.38333 2.32781 9.38333 2.50003L9.38333 9.38336L2.5 9.38336C2.32778 9.38336 2.18055 9.44169 2.05833 9.55836C1.94166 9.68058 1.88333 9.8278 1.88333 10C1.88333 10.1722 1.94166 10.3195 2.05833 10.4417C2.18055 10.5584 2.32778 10.6167 2.5 10.6167L9.38333 10.6167L9.38333 17.5C9.38333 17.6722 9.44166 17.8195 9.55833 17.9417C9.68055 18.0584 9.82777 18.1167 10 18.1167C10.1722 18.1167 10.3194 18.0584 10.4417 17.9417C10.5583 17.8195 10.6167 17.6722 10.6167 17.5L10.6167 10.6167L17.5 10.6167C17.6722 10.6167 17.8194 10.5584 17.9417 10.4417C18.0583 10.3195 18.1167 10.1722 18.1167 10C18.1167 9.8278 18.0583 9.68058 17.9417 9.55836C17.8194 9.44169 17.6722 9.38336 17.5 9.38336L10.6167 9.38336Z" fill="#777777" fill-rule="nonzero" />
              </svg>
            )}
            onAction={() => dialog.show(() => <DialogCreateGroup existingNames={groups.map(g => g.name)} onCreate={addGroup} />)}
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
                        class="group-item flex items-center gap-[8px] text-[12px] leading-[20px] cursor-pointer h-[36px] shrink-0 relative rounded-[8px] transition-colors"
                        classList={{
                          "bg-[rgba(10,89,247,0.08)]": isActive(),
                          "hover:bg-surface-base-hover": true,
                        }}
                        style={{
                          "padding-left": "12px",
                          "padding-right": showMenu() ? "28px" : (isActive() ? "12px" : "0"),
                          color: isActive() ? "#0A59F7" : "rgba(0,0,0,0.9)",
                        }}
                        onMouseEnter={() => setHoveredId(group.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <span style={{ width: "20px", height: "20px", display: "flex", "align-items": "center", "justify-content": "center", "flex-shrink": "0" }}>
                          <img src={expandedGroups().has(group.id) ? folderLinePng : folderLineClosePng} style={{ width: "20px", height: "20px", "flex-shrink": "0" }} alt="" draggable={false} />
                        </span>
                        <span
                          class="flex-1 min-w-0"
                          style={{
                            overflow: "hidden",
                            "white-space": "nowrap",
                            "text-overflow": "clip",
                            "mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
                            "-webkit-mask-image": "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
                            "mask-size": "100% 100%",
                            "-webkit-mask-size": "100% 100%",
                            "mask-repeat": "no-repeat",
                            "-webkit-mask-repeat": "no-repeat",
                          }}
                        >
                          {group.name}
                        </span>
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
                            <DropdownMenu.Content style={{ width: "175px", "min-height": "84px", padding: "4px", display: "flex", "flex-direction": "column", gap: "4px" }}>
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
                          sessions={api.sessions.filter(s => sessionGroupMapping[s.id] === group.id && !api.isPinned(s))}
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
            const api = sectionApi
            if (target) {
              const sessions = api
                ? api.sessions.filter(s => sessionGroupMapping[s.id] === target.id && !api.isPinned(s))
                : []
              if (sessions.length && api) await api.deleteSessions(sessions)
              clearGroup(target.id)
              removeGroup(target.id)
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
