import type { ResultTab } from "../components/result-viewer/tab-store"
import type { OutputCard, OutputCardType } from "../components/insight-turn"
import { autoSaveArtifact } from "./artifact-auto-save"
import { directoryHeader } from "@/utils/headers"
import type { WorkspaceKind } from "@/context/server"

/**
 * Unified persistence function for tab changes
 * 
 * Handles three persistence layers:
 * 1. localStorage snapshots (snapshotStore.save)
 * 2. File system (if tab has filePath)
 * 3. Project directory auto-save (Electron environment)
 */

export interface PersistenceOptions {
  sessionId: string
  projectDir?: string
  sdkUrl: string
  sdkDirectory: string
  snapshotStore: { save: (tab: ResultTab) => void }
  refreshSnapshots: () => void
  skipSnapshot?: boolean
  /** 工作区分类:"code"(代码工作区)时产物落 output/<sid前缀>/<原名>;缺省 "normal" 落 .octo/<sessionId>/outputs */
  workspaceKind?: WorkspaceKind
}

export async function persistTabChanges(
  tab: ResultTab,
  options: PersistenceOptions
): Promise<void> {
  const skipPersist = ["image", "video", "audio", "pdf", "svg", "text"].includes(tab.type)
  if (skipPersist) return

  // 1. Save localStorage snapshot (skip if disk history is handling it)
  if (!options.skipSnapshot) {
    options.snapshotStore.save(tab)
    options.refreshSnapshots()
  }

  // 2. Write to file system (if tab has filePath and content)
  if (tab.filePath && options.sdkDirectory && tab.content) {
    try {
      await fetch(`${options.sdkUrl}/file/content`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...directoryHeader(options.sdkDirectory),
        },
        body: JSON.stringify({ path: tab.filePath, content: tab.content }),
      })
    } catch (err) {
      console.error("[TabPersistence] failed to save file:", err)
    }
  }
  
  // 3. Auto-save to project directory (Electron environment only)
  // Skip if file is from Design Files panel (already exists on disk)
  // 代码工作区:output/ 下的产物文件同样已在盘上,autoSaveArtifact 的"已存在即跳过"策略兜底 (isFromDesignFiles 不匹配 .octo 路径)
  const normalizedPath = tab.filePath?.replace(/\\/g, "/")
  const isFromDesignFiles = normalizedPath && normalizedPath.includes(".octo/") && normalizedPath.includes(`/${options.sessionId}/`)
  if (options.projectDir && !isFromDesignFiles && tab.type !== "local-file") {
    const card: OutputCard = {
      id: tab.id,
      title: tab.title,
      type: tab.type as OutputCardType,
      content: tab.content,
      filePath: tab.filePath,
      artifactIdentifier: tab.artifactIdentifier,
      createdAt: tab.createdAt,
    }

    autoSaveArtifact(options.sessionId, card, options.projectDir, options.workspaceKind).catch((err) => {
      console.error("[TabPersistence] auto-save edited artifact failed:", err)
    })
  }
}

/**
 * Convert ResultTab to OutputCard format
 */
export function tabToOutputCard(tab: ResultTab): OutputCard | null {
  if (tab.type === "local-file") return null
  return {
    id: tab.id,
    title: tab.title,
    type: tab.type as OutputCardType,
    content: tab.content,
    filePath: tab.filePath,
    artifactIdentifier: tab.artifactIdentifier,
    createdAt: tab.createdAt,
  }
}