import type { ResultTab } from "../components/result-viewer/tab-store"
import type { OutputCard } from "../components/insight-turn"
import { autoSaveArtifact } from "./artifact-auto-save"

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
}

export async function persistTabChanges(
  tab: ResultTab,
  options: PersistenceOptions
): Promise<void> {
  // 1. Save localStorage snapshot (always)
  options.snapshotStore.save(tab)
  options.refreshSnapshots()
  
  // 2. Write to file system (if tab has filePath)
  if (tab.filePath && options.sdkDirectory) {
    try {
      await fetch(`${options.sdkUrl}/file/content`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": options.sdkDirectory,
        },
        body: JSON.stringify({ path: tab.filePath, content: tab.content }),
      })
    } catch (err) {
      console.error("[TabPersistence] failed to save file:", err)
    }
  }
  
  // 3. Auto-save to project directory (Electron environment only)
  if (options.projectDir) {
    const card: OutputCard = {
      id: tab.id,
      title: tab.title,
      type: tab.type,
      content: tab.content,
      filePath: tab.filePath,
      artifactIdentifier: tab.artifactIdentifier,
      createdAt: tab.createdAt,
    }
    
    autoSaveArtifact(options.sessionId, card, options.projectDir).catch((err) => {
      console.error("[TabPersistence] auto-save edited artifact failed:", err)
    })
  }
}

/**
 * Convert ResultTab to OutputCard format
 */
export function tabToOutputCard(tab: ResultTab): OutputCard {
  return {
    id: tab.id,
    title: tab.title,
    type: tab.type,
    content: tab.content,
    filePath: tab.filePath,
    artifactIdentifier: tab.artifactIdentifier,
    createdAt: tab.createdAt,
  }
}