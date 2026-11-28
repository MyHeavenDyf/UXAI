const deliverySkills = new Set(["chart-vue-creator", "fastui-vue-creator"])

type TurnPart = {
  type: string
  tool?: string
  files?: string[]
  state?: {
    status: string
    input?: Record<string, unknown>
    metadata?: { files?: unknown }
  }
}

type TurnSession = {
  sessionID: string
  parts: readonly TurnPart[]
}

type Project = { name: string; projectDir: string; skill?: string }

function usedDeliverySkill(session: TurnSession) {
  return session.parts.some((part) => {
    const name = part.state?.input?.name
    return part.type === "tool" && part.tool === "skill" && part.state?.status === "completed" &&
      typeof name === "string" && deliverySkills.has(name)
  })
}

/** 判断已正常完成的一轮是否有代码交付。调用方只传主轮和它关联的子任务。 */
export async function fastuiDeliveryNotice(input: {
  sessionID: string
  messageID: string
  workspaceDir: string
  sessions: readonly TurnSession[]
  resolveProject: (sessionID: string, filePath: string) => Promise<Project | undefined>
}) {
  const root = input.sessions.find((session) => session.sessionID === input.sessionID)
  const activatedInRoot = root && usedDeliverySkill(root)
  const workspace = input.workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "")
  const pathKey = (path: string) => /^[a-z]:\//i.test(path) ? path.toLowerCase() : path
  const projects = new Map<string, string>()
  for (const session of input.sessions) {
    const invokedInScope = activatedInRoot || usedDeliverySkill(session)
    const candidates = new Map<string, Array<Set<string>>>()
    for (const part of session.parts) {
      const toolInput = part.state?.input
      const toolPath = toolInput?.filePath ?? toolInput?.filepath ?? toolInput?.path
      const wroteFile = part.type === "tool" && part.state?.status === "completed" &&
        /write|edit/i.test(part.tool ?? "") && typeof toolPath === "string"
      const files = part.type === "patch" ? [...(part.files ?? [])] : wroteFile ? [toolPath] : []
      const appliedFiles = part.state?.metadata?.files
      if (part.type === "tool" && part.tool === "apply_patch" && part.state?.status === "completed" && Array.isArray(appliedFiles)) {
        for (const file of appliedFiles) {
          if (typeof file?.filePath === "string") files.push(file.filePath)
          if (typeof file?.movePath === "string") files.push(file.movePath)
        }
      }
      const paths = files.filter((file) => file.trim()).map((file) => {
        const path = file.trim().replace(/\\/g, "/")
        return /^(?:[a-z]:)?\//i.test(path) ? path : `${workspace}/${path}`
      })
      // 初始化脚手架的同一步会写工程标记和模板源码，后续步骤的源码变更另算。
      const marker = "/.octo-fastui.json"
      const scaffoldDirs = new Set(paths.map(pathKey).filter((path) => path.endsWith(marker))
        .map((path) => path.slice(0, -marker.length)))

      for (const path of paths) {
        if (!pathKey(path).includes("/packages/portal/src/")) continue
        const sourceSteps = candidates.get(path) ?? []
        sourceSteps.push(scaffoldDirs)
        candidates.set(path, sourceSteps)
      }
    }
    for (const [path, sourceSteps] of candidates) {
      const project = await input.resolveProject(session.sessionID, path)
      if (!project) continue
      // 续改一轮可以直接操作已有工程，不一定会再次加载技能。
      if (!invokedInScope && (!project.skill || !deliverySkills.has(project.skill))) continue
      const projectDir = pathKey(project.projectDir.replace(/\\/g, "/"))
      if (!pathKey(path).startsWith(`${projectDir}/packages/portal/src/`)) continue
      if (sourceSteps.every((dirs) => dirs.has(projectDir))) continue
      projects.set(projectDir, project.name)
    }
  }
  if (projects.size > 0) {
    return { key: `${input.sessionID}:${input.messageID}`, projects: [...projects.values()] }
  }
}
