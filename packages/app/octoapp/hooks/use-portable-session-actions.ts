import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, createSignal, type Accessor } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { requestPortableSessionImport } from "@/components/portable-session-import"
import { showSessionTransferProgress, watchSessionTransferProgress } from "@/components/session-transfer-progress"
import { sessionTitle } from "@/utils/session-title"
import { useWorkspaceKind } from "@/hooks/use-workspace-kind"

export function usePortableSessionActions(input: {
  session: Accessor<Session | null>
  close: () => void
}) {
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const server = useServer()
  const workspaceKind = useWorkspaceKind()
  const [action, setAction] = createSignal<"import" | "export">()
  const supported = createMemo(
    () =>
      platform.platform === "desktop" &&
      server.isLocal() &&
      !!platform.inspectPortableSession &&
      !!platform.openFilePickerDialog &&
      !!platform.saveFilePickerDialog,
  )
  const failed = (cause: unknown) => {
    showToast({
      variant: "error",
      title: language.t("session.portable.failed"),
      description: cause instanceof Error ? cause.message : String(cause),
    })
  }
  const exportSession = async () => {
    const session = input.session()
    if (!session || action() || !platform.saveFilePickerDialog) return
    input.close()
    const name = (sessionTitle(session.title) ?? "session")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
    const output = await platform
      .saveFilePickerDialog({
        title: language.t("session.portable.export.picker"),
        defaultPath: `${name || "session"}.zip`,
      })
      .catch((cause) => {
        failed(cause)
        return null
      })
    if (!output) return
    setAction("export")
    const operationID = crypto.randomUUID()
    const progress = showSessionTransferProgress("正在导出 Session")
    const watcher = new AbortController()
    void watchSessionTransferProgress({
      url: globalSDK.url,
      operationID,
      fetch: platform.fetch ?? fetch,
      signal: watcher.signal,
      update: progress.update,
    })
    await globalSDK
      .createClient({ directory: session.directory, throwOnError: true })
      .session
      .portableExport({
        sessionID: session.id,
        path: output,
        operationID,
        ...(workspaceKind() === "code" ? { scope: "project" as const } : {}),
      })
      .then((result) => {
        showToast({
          variant: "success",
          title: language.t("session.portable.export.success"),
          description: language.t("session.portable.export.success.description", {
            sessions: result.data!.sessions,
            files: result.data!.files,
            path: output,
          }),
          duration: 5000,
        })
      })
      .catch(failed)
      .finally(() => {
        watcher.abort()
        progress.dismiss()
        setAction()
      })
  }
  const importSession = async () => {
    if (action() || !platform.openFilePickerDialog) return
    input.close()
    const selected = await platform
      .openFilePickerDialog({
        title: language.t("session.portable.import.picker"),
        extensions: ["zip", "octosession"],
        accept: ["application/zip", "application/octet-stream"],
      })
      .catch((cause) => {
        failed(cause)
        return null
      })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return
    setAction("import")
    await requestPortableSessionImport(path)
      .then((result) => {
        showToast({
          variant: "success",
          title: language.t("session.portable.import.success"),
          description: language.t("session.portable.import.success.description", {
            sessions: result.sessions,
            files: result.files,
          }),
          duration: 5000,
        })
      })
      .catch(failed)
      .finally(() => setAction())
  }
  return { action, supported, exportSession, importSession }
}
