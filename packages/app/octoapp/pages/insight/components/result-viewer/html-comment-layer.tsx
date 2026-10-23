import { createEffect, onCleanup, Show } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { CommentPopover, type FileComment, type CommentPopoverTarget, type CommentAttachment } from "../../../make/components/result-viewer/comment-popover"
import { commentAuthor, commentPinTarget, commentTarget, type createHtmlComments } from "../../utils/html-comments"
import { getDesktopApi } from "../../lib/electron-api"
import { useHtmlReview } from "./html-review"

export function HtmlCommentLayer(props: { frame: HTMLIFrameElement | undefined; content: string }) {
  const review = useHtmlReview()
  const [state, setState] = createStore({
    comments: [] as FileComment[], target: null as CommentPopoverTarget | null,
    editing: null as FileComment | null, busy: false, loaded: false, externalClick: 0,
    width: 800, height: 600,
  })
  let disposed = false
  let generation = 0
  let operations = Promise.resolve()
  let popoverHost: HTMLDivElement | undefined
  onCleanup(() => { disposed = true; generation++ })
  const post = (message: object) => props.frame?.contentWindow?.postMessage(unwrap(message), "*")
  const sync = () => {
    post({ type: "od:comment-mode", enabled: !!review?.state.commenting && state.loaded })
    post({ type: "od:comment-saved-pins", comments: state.comments })
  }
  const close = () => {
    setState({ target: null, editing: null })
    post({ type: "od:comment-clear" })
  }
  createEffect(() => {
    const client = review?.comments()
    const version = ++generation
    setState({ comments: [], target: null, editing: null, busy: false, loaded: false })
    if (!client) return
    void client.load().then(comments => {
      if (!disposed && generation === version) setState({ comments, loaded: true })
    }).catch(() => {
      if (!disposed && generation === version) showToast({ title: "标注加载失败，请刷新预览重试", variant: "error" })
    })
  })
  createEffect(() => { props.content; close() })
  createEffect(sync)
  createEffect(() => {
    if (!review?.state.commenting) close()
  })
  createEffect(() => {
    const target = state.target
    const width = state.width
    const height = state.height
    if (!target) return
    // Store 可能原地合并目标，坐标变化也要重新限制弹窗位置。
    target.hoverPoint?.x
    target.hoverPoint?.y
    target.position.x
    target.position.y
    let cancelled = false
    let observer: ResizeObserver | undefined
    queueMicrotask(() => {
      if (cancelled) return
      const popover = popoverHost?.querySelector<HTMLElement>(".comment-popover")
      if (!popover) return
      // 仅约束 Insight 的弹窗；附件变化后按实际尺寸重新适配预览区。
      popover.style.maxWidth = `${Math.max(0, width - 16)}px`
      popover.style.maxHeight = `${Math.max(0, height - 16)}px`
      popover.style.overflowY = "auto"
      const fit = () => {
        const left = Math.max(8, Math.min(popover.offsetLeft, width - popover.offsetWidth - 8))
        const top = Math.max(8, Math.min(popover.offsetTop, height - popover.offsetHeight - 8))
        popover.style.transform = `translate(${left - popover.offsetLeft}px, ${top - popover.offsetTop}px)`
      }
      observer = new ResizeObserver(fit)
      observer.observe(popover)
      fit()
    })
    onCleanup(() => { cancelled = true; observer?.disconnect() })
  })
  createEffect(() => {
    const frame = props.frame
    if (!frame) return
    const measure = () => setState({ width: frame.clientWidth, height: frame.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    measure()
    frame.addEventListener("load", sync)
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return
      const data = event.data as Record<string, unknown>
      if (data.type === "od:comment-request-pins") {
        // 只回传标记，避免 mode → request-pins → mode 的递归消息。
        post({ type: "od:comment-saved-pins", comments: state.comments })
        return
      }
      if (!review?.state.commenting || !state.loaded || state.busy) return
      if (data.type === "od:comment-external-click") setState("externalClick", value => value + 1)
      if (data.type === "od:comment-target") {
        const target = commentTarget(data)
        if (target) setState({ target, editing: null })
      }
      if (data.type === "od:comment-pin-click") {
        const comment = state.comments.find(item => item.id === data.commentId)
        if (!comment) return
        const target = commentPinTarget(comment, data.pinPosition)
        if (target) setState({ target, editing: comment })
      }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    window.addEventListener("message", message)
    window.addEventListener("keydown", escape)
    onCleanup(() => {
      frame.removeEventListener("load", sync)
      observer.disconnect()
      window.removeEventListener("message", message)
      window.removeEventListener("keydown", escape)
    })
  })
  const run = (task: (client: ReturnType<typeof createHtmlComments>) => Promise<void>, failed?: () => void, queued = false) => {
    const client = review?.comments()
    if (!client || (state.busy && !queued)) return
    const version = generation
    setState("busy", true)
    const pending = operations.then(async () => {
      if (disposed || version !== generation) return
      try {
        await task(client)
        const comments = await client.load()
        if (!disposed && version === generation) {
          setState("comments", comments)
          if (state.editing) setState("editing", comments.find(item => item.id === state.editing?.id) ?? null)
          showToast({ title: "标注已更新" })
        }
      } catch (error) {
        if (!disposed && version === generation) {
          failed?.()
          showToast({ title: error instanceof Error ? error.message : "标注操作失败，请重试", variant: "error" })
        }
      } finally {
        if (!disposed && version === generation && operations === pending) setState("busy", false)
      }
    })
    operations = pending
    return pending
  }
  const save = (note: string, attachments: CommentAttachment[], pending: File[]) => {
    const target = state.target
    if (!target || !review?.path()) return
    const existing = state.editing
    const comment: FileComment = {
      ...commentAuthor(), ...(existing ?? {}),
      ...target, elementId: target.elementId ?? "", filePath: review.path()!,
      id: existing?.id ?? crypto.randomUUID(), note, attachments,
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
    }
    void run(async client => {
      await client.save(comment)
      if (!pending.length) return
      const api = getDesktopApi()
      if (!api?.getPathForFile) throw new Error("标注已保存，附件上传需要桌面端支持")
      for (const file of pending) {
        const path = api.getPathForFile(file)
        if (!path) throw new Error("标注已保存，但无法读取附件路径")
        const attachment = await client.upload(comment.id, file, path)
        comment.attachments = [...(comment.attachments ?? []), attachment]
        await client.save(comment)
      }
    }, () => setState({ target, editing: comment }))
  }
  return <Show when={state.target && review?.state.commenting}>
    <div class="absolute inset-0 pointer-events-none" style={{ "z-index": 20 }}>
      <div ref={popoverHost} class="pointer-events-auto">
        <CommentPopover target={state.target} comment={state.editing} readOnly={!!state.editing}
          iframeBounds={{ width: state.width, height: state.height }}
          externalClickSignal={state.externalClick} allComments={state.comments}
          onClose={close} onSave={save}
          onDelete={() => {
            const id = state.editing?.id
            if (id) void run(client => client.remove(id))
          }}
          onUploadAttachment={file => {
            const id = state.editing?.id
            if (!id) return
            const path = getDesktopApi()?.getPathForFile?.(file)
            void run(async client => {
              if (!path) throw new Error("无法读取附件路径")
              // 每项执行时读最新列表，避免后一个附件覆盖前一个附件。
              const comment = (await client.load()).find(item => item.id === id)
              if (!comment) throw new Error("标注不存在，请刷新后重试")
              const attachment = await client.upload(comment.id, file, path)
              await client.save({ ...comment, attachments: [...(comment.attachments ?? []), attachment], updatedAt: Date.now() })
            }, undefined, true)
          }}
          onDeleteAttachment={attachmentId => {
            const comment = state.editing ? { ...state.editing } : undefined
            if (!comment) return
            void run(async client => {
              await client.removeAttachment(comment.id, attachmentId)
              await client.save({ ...comment, attachments: comment.attachments?.filter(item => item.id !== attachmentId), updatedAt: Date.now() })
            })
          }}
          onPrevPin={() => {
            const index = state.comments.findIndex(item => item.id === state.editing?.id)
            const comment = state.comments[index - 1]
            if (comment) setState({ editing: comment, target: commentTarget(comment) ?? null })
          }}
          onNextPin={() => {
            const index = state.comments.findIndex(item => item.id === state.editing?.id)
            const comment = state.comments[index + 1]
            if (comment) setState({ editing: comment, target: commentTarget(comment) ?? null })
          }}
        />
      </div>
    </div>
  </Show>
}
