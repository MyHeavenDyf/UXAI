import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import {
  boardDraftReferences,
  boardGenerationError,
  boardReferenceActive,
  emptyBoard,
  newBoardCard,
  BOARD_VIDEO_REFERENCE_LIMIT,
  type BoardCard,
  type BoardReference,
} from "@opencode-ai/core/studio-board"
import { StudioBoardComposer } from "./studio-board-composer"

export function StudioBoardVideo(props: {
  source: BoardReference
  anchor: { left: number; top: number; width: number }
  hidden: boolean
  blocked: boolean
  canGenerate: boolean
  bounds: () => HTMLElement
  mediaURL: (value?: string) => string | undefined
  onUpload: (files: File[]) => Promise<BoardCard["draft"]["assets"]>
  onGenerate: (card: BoardCard, reference?: BoardReference) => void
  onError: (message: string) => void
  onRetryPermission: () => void
}) {
  const card = newBoardCard(crypto.randomUUID(), "video")
  card.title = "视频生成"
  card.draft.settings.videoInputMode = "first-last-frame"
  card.draft.settings.videoMode = "first_last_frame"
  const [state, setState] = createStore({
    card,
    reference: { ...props.source } as BoardReference | undefined,
    menuTab: "",
    uploading: false,
  })
  const document = createMemo(() => ({
    ...emptyBoard(),
    cards: [state.card],
    draftEdges: state.reference
      ? [
          {
            id: "video-source",
            sourceID: state.reference.sourceID,
            targetID: card.id,
            role: state.reference.role,
            reference: state.reference,
          },
        ]
      : [],
  }))
  const references = createMemo(() => boardDraftReferences(document(), card.id, () => undefined))
  const blocked = () => props.blocked || state.uploading
  const canGenerate = () =>
    !blocked() &&
    props.canGenerate &&
    !boardGenerationError("video", {
      ...state.card.draft,
      references: references(),
    })
  let composer: HTMLDivElement | undefined
  let dropdown: HTMLDivElement | undefined
  let uploadInput: HTMLInputElement | undefined
  let uploadRole: BoardReference["role"] = "firstFrame"
  let disposed = false
  const buttons = new Map<string, HTMLDivElement>()
  function positionDropdown() {
    const button = buttons.get(state.menuTab)
    if (!composer || !dropdown || !button) return
    const bounds = props.bounds().getBoundingClientRect()
    const anchor = button.getBoundingClientRect()
    const origin = composer.getBoundingClientRect()
    dropdown.style.maxWidth = `${bounds.width - 32}px`
    const menu = dropdown.firstElementChild
    if (menu instanceof HTMLElement) menu.style.maxHeight = `${bounds.height - 100}px`
    const popup = dropdown.getBoundingClientRect()
    const above = anchor.top - popup.height - 8
    dropdown.style.left = `${Math.max(bounds.left + 16, Math.min(bounds.right - popup.width - 16, anchor.left)) - origin.left}px`
    dropdown.style.top = `${Math.max(bounds.top + 80, Math.min(bounds.bottom - popup.height - 16, above >= bounds.top + 80 ? above : anchor.bottom + 8)) - origin.top}px`
    dropdown.style.visibility = "visible"
  }
  createEffect(
    on(
      () => [state.menuTab, props.anchor.left, props.anchor.top, props.anchor.width],
      () => {
        if (!state.menuTab) return
        queueMicrotask(positionDropdown)
        const observer = new ResizeObserver(positionDropdown)
        observer.observe(props.bounds())
        if (dropdown) observer.observe(dropdown)
        onCleanup(() => observer.disconnect())
      },
    ),
  )
  const dismiss = (event: Event) => {
    if (
      event.target instanceof Node &&
      (!composer?.contains(event.target) || (event.target instanceof Element && event.target.closest("textarea")))
    )
      setState("menuTab", "")
  }
  const escape = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      !state.menuTab ||
      !(event.target instanceof Node) ||
      !composer?.contains(event.target)
    )
      return
    event.stopPropagation()
    event.preventDefault()
    setState("menuTab", "")
  }
  window.document.addEventListener("pointerdown", dismiss, true)
  window.document.addEventListener("focusin", dismiss, true)
  window.document.addEventListener("keydown", escape, true)
  onCleanup(() => {
    disposed = true
    window.document.removeEventListener("pointerdown", dismiss, true)
    window.document.removeEventListener("focusin", dismiss, true)
    window.document.removeEventListener("keydown", escape, true)
  })
  function remove(reference: BoardReference) {
    if (blocked()) return
    if (reference.sourceID.startsWith("upload:")) {
      setState("card", "draft", "assets", (assets) => assets.filter((asset) => asset.id !== reference.mediaID))
      return
    }
    setState("reference", undefined)
  }
  async function upload(files: File[], role: BoardReference["role"]) {
    if (blocked() || !files.length || !boardReferenceActive("video", state.card.draft.settings, role)) return
    if (
      files.some(
        (file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024,
      )
    ) {
      props.onError("请选择 10MB 以内的 PNG、JPG 或 WebP 图片")
      return
    }
    if (role !== "reference" && files.length > 1) {
      props.onError("每个首尾帧槽位仅支持一张图片")
      return
    }
    if (
      files.length + references().filter((ref) => role === "reference" || ref.role !== role).length >
      BOARD_VIDEO_REFERENCE_LIMIT
    ) {
      props.onError("参考图数量超过当前模型上限")
      return
    }
    setState({ menuTab: "", uploading: true })
    await props
      .onUpload(files)
      .then((assets) => {
        if (disposed || !assets.length) return
        batch(() => {
          setState("card", "draft", "assets", (items) => [
            ...items.filter((asset) => role === "reference" || asset.role !== role),
            ...assets.map((asset) => ({ ...asset, role })),
          ])
          if (role !== "reference" && state.reference?.role === role) setState("reference", undefined)
        })
      })
      .catch((error: unknown) => {
        if (!disposed) props.onError(error instanceof Error ? error.message : "上传失败")
      })
      .finally(() => {
        if (!disposed) setState("uploading", false)
      })
  }
  return (
    <StudioBoardComposer
      card={state.card}
      document={document()}
      references={references()}
      anchor={props.anchor}
      hidden={props.hidden}
      blocked={blocked()}
      canGenerate={canGenerate()}
      menusBlocked={blocked()}
      menuTab={state.menuTab}
      showMentionEntry={false}
      mediaURL={props.mediaURL}
      elements={{
        composer: (element) => {
          composer = element
        },
        uploadInput: (element) => {
          uploadInput = element
        },
        dropdown: (element) => {
          dropdown = element
          queueMicrotask(positionDropdown)
        },
        menuButton: (tab, element) => buttons.set(tab, element),
      }}
      onUpload={(files) => void upload(files, uploadRole)}
      onDropUpload={(files, role) => void upload(files, role)}
      onPickUpload={(role) => {
        if (blocked() || !uploadInput) return
        setState("menuTab", "")
        uploadRole = role
        uploadInput.multiple = role === "reference"
        uploadInput.click()
      }}
      onSwapFrames={() => {
        if (blocked()) return
        const swap = (role: BoardReference["role"]) =>
          role === "firstFrame" ? ("lastFrame" as const) : role === "lastFrame" ? ("firstFrame" as const) : role
        batch(() => {
          if (state.reference) setState("reference", "role", swap(state.reference.role))
          setState("card", "draft", "assets", (assets) => assets.map((asset) => ({ ...asset, role: swap(asset.role) })))
        })
      }}
      onRemoveReference={remove}
      onPrompt={(value) => {
        if (!blocked()) {
          setState("menuTab", "")
          setState("card", "draft", "prompt", value)
        }
      }}
      onMenuTab={(tab) => setState("menuTab", tab)}
      onStyleModel={() => {}}
      onSetting={(key, value) => {
        if (blocked()) return
        setState("card", "draft", "settings", key, value)
      }}
      onMention={() => {}}
      onGenerate={() => {
        setState("menuTab", "")
        queueMicrotask(() => {
          if (disposed || !canGenerate()) return
          setState("card", "draft", "settings", "videoMode", references().length ? "first_last_frame" : "text")
          props.onGenerate(state.card, state.reference)
        })
      }}
      onRetryPermission={props.onRetryPermission}
    />
  )
}
