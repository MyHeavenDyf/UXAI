import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX, type Resource } from "solid-js"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import { usePlatform } from "@/context/platform"
import { STUDIO_ASPECT_RATIOS, STUDIO_CAPABILITIES, STUDIO_STYLE_MODELS, capabilityLabel, styleModelLabel } from "./data"
import { getDefaultDimensions, getModelResolutionKey, STUDIO_VIDEO_ASPECT_RATIOS, SUPPORTED_STUDIO_CAPABILITIES, workspaceModeForCapability, type StudioVideoDuration, type StudioVideoFrameSlot, type StudioVideoQualityMode } from "./studio-shared"
import { MaterialMenu, type MaterialWordBook } from "./MaterialMenu"
import type { StudioAsset, StudioAspectRatio, StudioCapability, StudioGenerationStatus } from "./types"
import { StudioVideoRiskContent } from "./studio-video-risk-dialog"

const STUDIO_VIDEO_GUIDE_URL = "https://www.volcengine.com/docs/82379/2222480?lang=zh"

export function StudioIntro(): JSX.Element {
  return (
    <div class="studio-intro">
      <img src={IconHost} width={80} height={80} alt="" style={{ "flex-shrink": "0" }} />
      <div class="studio-intro-copy">
        <div class="studio-intro-title">Octo Studio</div>
        <div class="studio-intro-subtitle">一键创意落地，让视觉生产力触手可及</div>
      </div>
    </div>
  )
}

export function StudioComposer(props: {
  prompt: string
  capability: StudioCapability
  canGenerateVideo: boolean
  canUseSeedream: boolean
  styleModel: string
  maxReferenceImages: number
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  customWidth: number
  customHeight: number
  isCustom: boolean
  assets: StudioAsset[]
  videoFrames: { first?: StudioAsset; last?: StudioAsset }
  videoDuration: StudioVideoDuration
  videoQualityMode: StudioVideoQualityMode
  videoQualityLocked: boolean
  status: StudioGenerationStatus
  openMenu: "capability" | "style" | "settings" | "material" | null
  canSubmit: boolean
  wordBook?: Resource<MaterialWordBook[]>
  onPrompt: (value: string) => void
  onCapability: (value: StudioCapability) => void
  onStyleModel: (value: string) => void
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onCustomWidth: (value: number) => void
  onCustomHeight: (value: number) => void
  onIsCustom: (value: boolean) => void
  onVideoDuration: (value: StudioVideoDuration) => void
  onVideoQualityMode: (value: StudioVideoQualityMode) => void
  onOpenMenu: (value: "capability" | "style" | "settings" | "material" | null) => void
  onReversePrompt?: () => void
  onCancel?: () => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPickFile: () => void
  onPickVideoFrame: (slot: StudioVideoFrameSlot) => void
  onPasteImage: (files: File[]) => void
  onRemoveAsset: (id: string) => void
  onRemoveVideoFrame: (slot: StudioVideoFrameSlot) => void
  onSwapVideoFrames: () => void
  onToolClick?: () => void
}): JSX.Element {
  const platform = usePlatform()
  let inputRef!: HTMLTextAreaElement
  let pointerDownOpenMenu: typeof props.openMenu = null
  let referenceHoverFrame: number | undefined
  const [composing, setComposing] = createSignal(false)
  const [referenceExpanded, setReferenceExpanded] = createSignal(false)
  const [referenceHoverReady, setReferenceHoverReady] = createSignal(false)
  const referenceAssets = createMemo(() => props.assets.slice(0, props.maxReferenceImages))
  const referenceAsset = createMemo(() => referenceAssets()[0])
  const canAddReferenceAsset = createMemo(() => referenceAssets().length < props.maxReferenceImages)
  const isImageGeneration = createMemo(() => props.capability === "image.generate")
  const isVideoGeneration = createMemo(() => props.capability === "video.generate")
  const isEditingCapability = createMemo(() => Boolean(workspaceModeForCapability(props.capability)))
  const isImeComposing = (event: KeyboardEvent) => event.isComposing || composing() || event.keyCode === 229
  const isBusy = createMemo(() => props.status === "queued" || props.status === "running" || props.status === "submitting")
  onCleanup(() => {
    if (referenceHoverFrame !== undefined) cancelAnimationFrame(referenceHoverFrame)
  })
  createEffect((previousReferenceCount = 0) => {
    const referenceCount = referenceAssets().length
    if (!referenceCount) {
      setReferenceExpanded(false)
      setReferenceHoverReady(false)
      return referenceCount
    }
    if (previousReferenceCount) return referenceCount
    setReferenceExpanded(false)
    setReferenceHoverReady(false)
    referenceHoverFrame = requestAnimationFrame(() => {
      referenceHoverFrame = undefined
      setReferenceHoverReady(true)
    })
    return referenceCount
  }, 0)
  const resizeInput = () => {
    if (!inputRef) return
    inputRef.style.height = "auto"
    inputRef.style.height = `${Math.min(inputRef.scrollHeight, 180)}px`
  }
  const [lastValidCustomLabel, setLastValidCustomLabel] = createSignal("")
  const isJimengModel = () => props.styleModel === "seedream-5-lite" || (getModelResolutionKey(props.styleModel) !== "default" && getModelResolutionKey(props.styleModel) !== "hdesign" && props.styleModel !== "qwen")
  // 弹框打开时锁定 toolbar 自定义尺寸显示值，比例和张数实时同步
  const [committedCustomW, setCommittedCustomW] = createSignal(props.customWidth)
  const [committedCustomH, setCommittedCustomH] = createSignal(props.customHeight)
  const [committedIsCustom, setCommittedIsCustom] = createSignal(props.isCustom)
  const settingsOpen = createMemo(() => props.openMenu === "settings")
  createEffect(() => {
    if (!settingsOpen()) {
      // 弹框关闭，同步最新自定义尺寸到 toolbar
      setCommittedCustomW(props.customWidth)
      setCommittedCustomH(props.customHeight)
      setCommittedIsCustom(props.isCustom)
    }
  })
  const imageSettingsLabel = createMemo(() => {
    // 比例和张数实时同步（点击即生效），自定义尺寸在弹框打开时锁定避免打字过程中闪烁
    const aspectRatio = props.aspectRatio
    const customW = settingsOpen() ? committedCustomW() : props.customWidth
    const customH = settingsOpen() ? committedCustomH() : props.customHeight
    const isCustomState = settingsOpen() ? committedIsCustom() : props.isCustom
    const isCustom = isCustomState && customW > 0 && customH > 0
    let ratio: string
    if (isCustom) {
      const label = `${customW}×${customH}`
      if (isJimengModel()) {
        const area = customW * customH
        const areaMin = 2560 * 1440
        const areaMax = Math.round(3072 * 3072 * 1.1025)
        const areaOk = area >= areaMin && area <= areaMax
        const ratioVal = customW / customH
        const ratioOk = ratioVal >= 1 / 16 && ratioVal <= 16
        if (areaOk && ratioOk) {
          setLastValidCustomLabel(label)
        }
        ratio = (areaOk && ratioOk) ? label : (lastValidCustomLabel() || aspectRatio)
      } else {
        setLastValidCustomLabel(label)
        ratio = label
      }
    } else {
      ratio = aspectRatio
    }
    const isCustomValid = isCustom && ratio !== aspectRatio
    const iconStyle = () => {
      if (isCustomValid) return { "--icon-w": "12px", "--icon-h": "12px" }
      const item = aspectRatio
      switch (item) {
        case "1:1": return { "--icon-w": "10.5px", "--icon-h": "10.5px" }
        case "2:3": return { "--icon-w": "9.32px", "--icon-h": "12.82px" }
        case "3:2": return { "--icon-w": "12.82px", "--icon-h": "9.32px" }
        case "3:4": return { "--icon-w": "10.5px", "--icon-h": "11.68px" }
        case "4:3": return { "--icon-w": "11.68px", "--icon-h": "10.5px" }
        case "9:16": return { "--icon-w": "9.04px", "--icon-h": "14px" }
        case "16:9": return { "--icon-w": "14px", "--icon-h": "9.04px" }
        default: return { "--icon-w": "12px", "--icon-h": "12px" }
      }
    }
    return (
      <>
        <Show when={!isCustomValid}>
          <span
            class="studio-composer-icon-tool-ratio-icon"
            style={iconStyle()}
          />
        </Show>
        <span class="studio-composer-icon-tool-text">{ratio}</span>
        <span class="studio-composer-icon-tool-sep" />
        <span class="studio-composer-icon-tool-text">{props.count}</span>
      </>
    )
  })

  // Refs for measuring button positions — dropdowns are rendered outside
  // .studio-composer-toolbar-items (which has overflow:hidden) so they
  // need explicit left positioning to align with their buttons.
  let toolbarRef!: HTMLDivElement
  const buttonRefs = new Map<string, HTMLElement>()
  const anchorRefs = new Map<string, HTMLDivElement>()

  // Toolbar overflow detection
  const [toolbarOverflow, setToolbarOverflow] = createSignal<string[]>([])
  const [styleExpanded, setStyleExpanded] = createSignal(false)
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false)
  const [moreMenuTick, setMoreMenuTick] = createSignal(0)
  const moreMenuStyle = (): JSX.CSSProperties => {
    // 窗口尺寸变化时重新计算位置，使菜单跟随更多按钮
    moreMenuTick()
    if (!moreButtonRef) return {}
    const rect = moreButtonRef.getBoundingClientRect()
    const menuWidth = 175
    const left = Math.max(0, Math.min(rect.left, window.innerWidth - menuWidth - 8))
    return { position: "fixed", bottom: `${window.innerHeight - rect.top + 4}px`, left: `${left}px` }
  }
  let toolbarItemsRef!: HTMLDivElement
  let moreButtonRef!: HTMLButtonElement
  const itemWidthCache = new Map<string, number>()

  const toolbarItemKeys = createMemo(() => {
    if (isImageGeneration()) return ["capability", "style", "settings", "reverse", "material"]
    if (isVideoGeneration()) return ["capability", "settings"]
    return ["capability"]
  })

  function checkToolbarOverflow() {
    if (!toolbarItemsRef) return
    const containerWidth = toolbarItemsRef.clientWidth
    const keys = toolbarItemKeys()
    const moreBtnWidth = 40 // 32px button + 8px gap

    // Cache item widths from DOM
    const items = toolbarItemsRef.querySelectorAll<HTMLElement>('[data-toolbar-item]')
    for (const item of items) {
      const key = item.dataset.toolbarItem
      if (key && item.offsetWidth > 0) itemWidthCache.set(key, item.offsetWidth)
    }

    // Measure style label natural width to decide if it can be fully shown
    const styleLabel = toolbarItemsRef.querySelector<HTMLElement>('[data-toolbar-item="style"] .studio-composer-tool-label')
    let styleNaturalWidth = 0
    let styleTruncatedWidth = 0
    if (styleLabel) {
      // natural button width = label content + padding(24) + caret(16) + gap(2)
      const naturalWidth = styleLabel.scrollWidth + 42
      styleNaturalWidth = Math.max(70, naturalWidth)
      styleTruncatedWidth = Math.max(70, Math.min(naturalWidth, 98))
      itemWidthCache.set("style", styleTruncatedWidth)
    }

    // Try fitting everything with the style label fully shown
    if (styleNaturalWidth > styleTruncatedWidth) {
      let totalExpanded = 0
      for (const key of keys) {
        const w = key === "style" ? styleNaturalWidth : (itemWidthCache.get(key) ?? 0)
        totalExpanded += w + 8 // item + gap
      }
      if (totalExpanded > 0) totalExpanded -= 8 // remove last gap
      if (totalExpanded <= containerWidth) {
        setStyleExpanded(true)
        if (toolbarOverflow().length > 0) setToolbarOverflow([])
        return
      }
    }

    // Width not enough — keep style label truncated (current style)
    setStyleExpanded(false)

    // Calculate total width of all items
    let totalWidth = 0
    for (const key of keys) {
      totalWidth += (itemWidthCache.get(key) ?? 0) + 8 // item + gap
    }
    if (totalWidth > 0) totalWidth -= 8 // remove last gap
    if (totalWidth <= containerWidth) {
      if (toolbarOverflow().length > 0) setToolbarOverflow([])
      return
    }

    // Hide items from the end until remaining + more button fits
    const overflow: string[] = []
    let visibleWidth = totalWidth
    for (let i = keys.length - 1; i >= 2; i--) {
      const key = keys[i]
      const w = (itemWidthCache.get(key) ?? 0) + 8
      visibleWidth -= w
      overflow.push(key)
      if (visibleWidth + moreBtnWidth <= containerWidth) break
    }
    if (overflow.filter(k => (itemWidthCache.get(k) ?? 0) > 0).length <= 1) {
      if (toolbarOverflow().length > 0) setToolbarOverflow([])
      return
    }
    // More button is shown — if the remaining slack can fit the full style label, expand it
    if (styleNaturalWidth > styleTruncatedWidth) {
      const visibleExpanded = visibleWidth - styleTruncatedWidth + styleNaturalWidth
      if (visibleExpanded + moreBtnWidth <= containerWidth) setStyleExpanded(true)
    }
    const current = toolbarOverflow()
    if (overflow.length !== current.length || !overflow.every((k, i) => k === current[i])) {
      setToolbarOverflow(overflow)
    }
  }

  onMount(() => {
    requestAnimationFrame(() => {
      checkToolbarOverflow()
      resizeInput()
    })
    const observer = new ResizeObserver(() => checkToolbarOverflow())
    if (toolbarItemsRef) observer.observe(toolbarItemsRef)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    props.prompt
    queueMicrotask(resizeInput)
    props.styleModel
    props.customWidth
    props.customHeight
    props.isCustom
    props.aspectRatio
    props.count
    props.capability
    toolbarOverflow()
    requestAnimationFrame(() => checkToolbarOverflow())
  })

  // Close more menu on outside click
  createEffect(() => {
    if (!moreMenuOpen()) return
    const handler = (e: MouseEvent) => {
      if (moreButtonRef?.contains(e.target as Node)) return
      if (moreMenuRef?.contains(e.target as Node)) return
      if ((e.target as HTMLElement)?.closest(".studio-composer-toolbar-more-menu")) return
      if ((e.target as HTMLElement)?.closest(".studio-composer-dropdown-anchor")) return
      setMoreMenuOpen(false)
    }
    document.addEventListener("pointerdown", handler)
    onCleanup(() => document.removeEventListener("pointerdown", handler))
  })

  // 更多菜单展开时，窗口尺寸变化重新定位以跟随更多按钮
  createEffect(() => {
    if (!moreMenuOpen()) return
    const onResize = () => requestAnimationFrame(() => setMoreMenuTick((v) => v + 1))
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  // Close more menu when a popup opens from toolbar (not from more menu)
  createEffect(() => {
    const menu = props.openMenu
    if (menu && !toolbarOverflow().includes(menu)) {
      setMoreMenuOpen(false)
    }
  })

  // 更多按钮不显示时（工具栏无溢出）自动收起更多菜单
  createEffect(() => {
    if (moreMenuOpen() && toolbarOverflow().length === 0) {
      setMoreMenuOpen(false)
    }
  })

  // 弹窗打开时，若对应按钮进入溢出区且更多菜单未展开 → 关闭弹窗
  createEffect(() => {
    const menu = props.openMenu
    if (!menu) return
    const overflow = toolbarOverflow()
    if (overflow.includes(menu) && !moreMenuOpen()) {
      props.onOpenMenu(null)
    }
  })

  let moreMenuRef!: HTMLDivElement

  function positionDropdown(menu: typeof props.openMenu) {
    if (!menu) return
    const overflow = toolbarOverflow()
    const anchor = anchorRefs.get(menu)
    if (!anchor || !toolbarRef) return

    if (overflow.includes(menu) && moreMenuRef) {
      // Position to the right of the more menu, bottom-aligned
      const menuRect = moreMenuRef.getBoundingClientRect()
      const toolbarRect = toolbarRef.getBoundingClientRect()
      anchor.style.left = `${menuRect.right - toolbarRect.left + 1}px`
      anchor.style.top = "auto"
      // .studio-menu has bottom:calc(100%+8px), so offset by -8 to align
      anchor.style.bottom = `${toolbarRect.bottom - menuRect.bottom - 8}px`
      return
    }

    const btn = buttonRefs.get(menu)
    if (!btn) return
    const btnRect = btn.getBoundingClientRect()
    const toolbarRect2 = toolbarRef.getBoundingClientRect()
    if (window.innerWidth < 1024) {
      // 窄视口：弹窗与按钮居中对齐，空间不足时自动收窄避免被 overflow:hidden 裁切
      const popup = anchor.firstElementChild as HTMLElement
      if (popup) {
        popup.style.maxWidth = ""
        const naturalWidth = popup.offsetWidth
        if (naturalWidth > 0) {
          const availableWidth = window.innerWidth - toolbarRect2.left - 16
          if (availableWidth < naturalWidth) {
            popup.style.maxWidth = `${availableWidth}px`
            anchor.style.left = "0px"
          } else {
            const btnCenter = btnRect.left - toolbarRect2.left + btnRect.width / 2
            let left = btnCenter - naturalWidth / 2
            const maxLeft = window.innerWidth - 8 - naturalWidth - toolbarRect2.left
            left = Math.max(0, Math.min(left, maxLeft))
            anchor.style.left = `${left}px`
          }
        } else {
          anchor.style.left = `${btnRect.left - toolbarRect2.left}px`
        }
      } else {
        anchor.style.left = `${btnRect.left - toolbarRect2.left}px`
      }
    } else {
      // 宽视口：保持原有左对齐行为，不约束弹窗宽度
      const popup = anchor.firstElementChild as HTMLElement
      if (popup) popup.style.maxWidth = ""
      anchor.style.left = `${btnRect.left - toolbarRect2.left}px`
    }
    anchor.style.top = ""
    anchor.style.bottom = ""
  }

  createEffect(() => {
    const menu = props.openMenu
    if (!menu) return
    // 工具栏溢出变化时重新定位：按钮在工具栏与更多菜单间切换时弹框需重新对齐
    toolbarOverflow()
    // Defer measurement to next microtask so the DOM has updated
    queueMicrotask(() => positionDropdown(menu))
  })

  onMount(() => {
    // Re-measure on resize in case button widths change
    const observer = new ResizeObserver(() => {
      if (props.openMenu) positionDropdown(props.openMenu)
    })
    if (toolbarRef) observer.observe(toolbarRef)
    onCleanup(() => observer.disconnect())
  })

  // 窗口尺寸变化时重新定位弹窗（居中弹窗可能在窄窗口下溢出视口）
  createEffect(() => {
    const menu = props.openMenu
    if (!menu) return
    const onResize = () => positionDropdown(menu)
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
  })

  function handlePaste(event: ClipboardEvent) {
    if (isBusy() || !isImageGeneration() && !isVideoGeneration()) return
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    props.onPasteImage(files)
  }

  function referenceAssetRotation(index: number) {
    return [-7.8, 4.1, -3.6][index] ?? 0
  }

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!props.openMenu) return
    if (event.target instanceof Element && event.target.closest(".studio-menu")) return
    props.onOpenMenu(null)
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown)
  onCleanup(() => document.removeEventListener("pointerdown", handleDocumentPointerDown))

  return (
    <div class="studio-composer-wrap relative shrink-0">
      <div class="studio-composer" classList={{ video: isVideoGeneration() }}>
        <Show when={isVideoGeneration()}>
          <div class="studio-composer-video-frames">
            <VideoFrameButton
              label="首帧"
              asset={props.videoFrames.first}
              disabled={isBusy()}
              onPick={() => props.onPickVideoFrame("first")}
              onRemove={() => props.onRemoveVideoFrame("first")}
            />
            <button type="button" class="studio-composer-video-swap" onClick={props.onSwapVideoFrames} disabled={isBusy()} aria-label="交换首尾帧" title="交换首尾帧">
              <img src="/studio/ic_public_switchover.svg" class="studio-composer-video-swap-icon" alt="" />
            </button>
            <VideoFrameButton
              label="尾帧"
              asset={props.videoFrames.last}
              disabled={isBusy()}
              onPick={() => props.onPickVideoFrame("last")}
              onRemove={() => props.onRemoveVideoFrame("last")}
            />
          </div>
        </Show>
        <div class="studio-composer-input-row" classList={{ "with-reference": isImageGeneration() }}>
          <Show when={isImageGeneration()}>
            <div class="studio-composer-ref-slot" classList={{ filled: Boolean(referenceAsset()) }}>
              <Show
                when={referenceAsset()}
                fallback={
                  <button
                    type="button"
                    onClick={props.onPickFile}
                    disabled={isBusy()}
                    class="studio-composer-ref-btn"
                    title="上传参考图"
                  />
                }
              >
                <div
                  class="studio-composer-ref-stack"
                  classList={{ expanded: referenceExpanded() }}
                  onPointerMove={(event) => {
                    if (!referenceHoverReady() || (!event.movementX && !event.movementY) || referenceExpanded()) return
                    setReferenceExpanded(true)
                  }}
                  onPointerLeave={() => setReferenceExpanded(false)}
                >
                  <For each={referenceAssets()}>
                    {(asset, index) => (
                      <div
                        class="studio-composer-ref-item"
                        style={{
                          "--ref-index": String(index()),
                          "--ref-rotate": `${referenceAssetRotation(index())}deg`,
                        }}
                      >
                        <div class="studio-composer-ref-btn" title={asset.name}>
                          <img src={asset.dataUrl} alt={asset.name} class="studio-composer-ref-image" />
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onRemoveAsset(asset.id)
                          }}
                          disabled={isBusy()}
                          class="studio-composer-ref-remove"
                          aria-label="删除参考图"
                          title="删除参考图"
                        >
                          <img src="/studio/studio-img-delete-icon.svg" class="studio-composer-ref-remove-icon" alt="" />
                        </button>
                      </div>
                    )}
                  </For>
                  <Show when={referenceExpanded() && canAddReferenceAsset()}>
                    <button
                      type="button"
                      onClick={props.onPickFile}
                      disabled={isBusy()}
                      class="studio-composer-ref-btn studio-composer-ref-add"
                      title="继续上传参考图"
                    />
                  </Show>
                </div>
                <Show when={referenceAssets().length > 0 && canAddReferenceAsset() && !referenceExpanded()}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onPickFile()
                    }}
                    disabled={isBusy()}
                    class="studio-composer-ref-upload-float"
                    aria-label="继续上传参考图"
                    title="继续上传参考图"
                  >
                    <img src="/studio/studio_mask.svg" alt="" />
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
          <div class="studio-composer-input-wrap">
            <textarea
              ref={inputRef}
              value={props.prompt}
              onInput={(event) => {
                props.onPrompt(event.currentTarget.value)
                resizeInput()
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isImeComposing(event)) return
                props.onKeyDown(event)
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onBlur={() => setComposing(false)}
              onPaste={handlePaste}
              placeholder={isVideoGeneration() ? undefined : isEditingCapability() ? "请前往编辑区，在右侧进行编辑" : "上传参考图、输入文字，描述你想生成的图片。"}
              class="studio-composer-input"
              disabled={isEditingCapability()}
            />
            <Show when={isVideoGeneration() && !props.prompt}>
              <div class="studio-composer-video-placeholder" onClick={() => inputRef.focus()}>
                请描述你想生成的视频内容，或使用反推描述图片，也可查看
                <a
                  href={STUDIO_VIDEO_GUIDE_URL || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="studio-composer-video-guide-link"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!STUDIO_VIDEO_GUIDE_URL) return
                    event.preventDefault()
                    platform.openLink(STUDIO_VIDEO_GUIDE_URL)
                  }}
                >
                  使用指南
                </a>
                提升生成效果。
              </div>
            </Show>
          </div>
        </div>

        <div class="studio-composer-toolbar" ref={toolbarRef}>
          <div class="studio-composer-toolbar-items" ref={toolbarItemsRef!}>
            <div class="relative studio-composer-toolbar-item" ref={(el) => buttonRefs.set("capability", el)} data-toolbar-item="capability">
              <ToolButton
                label={capabilityLabel(props.capability)}
                active={props.openMenu === "capability"}
                disabled={isBusy()}
                onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                onClick={() => props.onOpenMenu(pointerDownOpenMenu === "capability" ? null : "capability")}
              />
            </div>
            <Show when={isImageGeneration()}>
              <div class="relative studio-composer-toolbar-item studio-composer-toolbar-item--style" classList={{ "studio-composer-toolbar-item--expanded": styleExpanded() }} ref={(el) => buttonRefs.set("style", el)} data-toolbar-item="style">
                <ToolButton
                  label={styleModelLabel(props.styleModel)}
                  active={props.openMenu === "style"}
                  disabled={isBusy()}
                  onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                  onClick={() => props.onOpenMenu(pointerDownOpenMenu === "style" ? null : "style")}
                />
              </div>
              <Show when={!toolbarOverflow().includes("settings")}>
                <div class="relative studio-composer-toolbar-item studio-composer-toolbar-item--settings" ref={(el) => buttonRefs.set("settings", el)} data-toolbar-item="settings">
                  <IconTool
                    label="参数"
                    children={imageSettingsLabel()}
                    disabled={isBusy()}
                    onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                    onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
                  />
                </div>
              </Show>
              <Show when={!toolbarOverflow().includes("reverse")}>
	                <div class="relative studio-composer-toolbar-item" data-toolbar-item="reverse">
                  <IconTool
                    label="图文反推"
                    class="studio-composer-icon-reverse"
                    disabled={isBusy()}
                    onClick={() => props.onReversePrompt?.()}
                  />
                </div>
              </Show>
              <Show when={!toolbarOverflow().includes("material")}>
                <div class="relative studio-composer-toolbar-item studio-composer-toolbar-item--material" ref={(el) => buttonRefs.set("material", el)} data-toolbar-item="material">
                  <IconTool
                    label="词书"
                    disabled={isBusy()}
                    onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                    onClick={() => props.onOpenMenu(pointerDownOpenMenu === "material" ? null : "material")}
                  />
                </div>
              </Show>
              <Show when={toolbarOverflow().length > 0}>
                <button
                  type="button"
                  ref={moreButtonRef!}
                  class="studio-composer-toolbar-more"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  title="更多"
                />
              </Show>
            </Show>
            <Show when={isVideoGeneration()}>
              <Show when={!toolbarOverflow().includes("settings")}>
                <div class="relative studio-composer-toolbar-item studio-composer-toolbar-item--settings" ref={(el) => buttonRefs.set("video-settings", el)} data-toolbar-item="settings">
                  <IconTool
                    label="参数"
                    children={imageSettingsLabel()}
                    disabled={isBusy()}
                    onPointerDown={() => { pointerDownOpenMenu = props.openMenu }}
                    onClick={() => props.onOpenMenu(pointerDownOpenMenu === "settings" ? null : "settings")}
                  />
                </div>
              </Show>
              <Show when={toolbarOverflow().length > 0}>
                <button
                  type="button"
                  ref={moreButtonRef!}
                  class="studio-composer-toolbar-more"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  title="更多"
                />
              </Show>
            </Show>
          </div>
          <Show when={moreMenuOpen()}>
            <div
              ref={moreMenuRef!}
              class="studio-composer-toolbar-more-menu"
              style={moreMenuStyle()}
              onClick={(e) => e.stopPropagation()}
            >
                <Show when={isImageGeneration()}>
                  <Show when={toolbarOverflow().includes("settings")}>
                    <button
                      type="button"
                      class="studio-composer-toolbar-more-item"
                      classList={{ active: props.openMenu === "settings" }}
                      onClick={() => props.onOpenMenu("settings")}
                    >
                      <img src="/studio/IconParameter.svg" alt="" class="studio-composer-toolbar-more-item-icon" />
                      <span>图片设置</span>
                    </button>
                  </Show>
                  <Show when={toolbarOverflow().includes("reverse")}>
                    <button
                      type="button"
                      class="studio-composer-toolbar-more-item"
                      onClick={() => props.onReversePrompt?.()}
                    >
                      <span class="studio-composer-toolbar-more-item-icon studio-composer-icon-reverse-icon" />
                      <span>图文反推</span>
                    </button>
                  </Show>
                  <Show when={toolbarOverflow().includes("material")}>
                    <button
                      type="button"
                      class="studio-composer-toolbar-more-item"
                      classList={{ active: props.openMenu === "material" }}
                      onClick={() => props.onOpenMenu("material")}
                    >
                      <img src="/studio/IconMaterial.svg" alt="" class="studio-composer-toolbar-more-item-icon" />
                      <span>词书</span>
                      <svg class="studio-composer-toolbar-more-item-arrow" viewBox="0 0 6 11" width="5.74" height="10.6"><path d="M0.5 0.5l5 5-5 5" fill="none" stroke="rgba(0,0,0,0.9)" stroke-width="1"/></svg>
                    </button>
                  </Show>
                </Show>
                <Show when={isVideoGeneration()}>
                  <Show when={toolbarOverflow().includes("settings")}>
                    <button
                      type="button"
                      class="studio-composer-toolbar-more-item"
                      classList={{ active: props.openMenu === "settings" }}
                      onClick={() => props.onOpenMenu("settings")}
                    >
                      <img src="/studio/IconParameter.svg" alt="" class="studio-composer-toolbar-more-item-icon" />
                      <span>图片设置</span>
                    </button>
                  </Show>
                </Show>
              </div>
          </Show>
          <Show when={props.openMenu === "capability"}>
            <div class="studio-composer-dropdown-anchor" ref={(el) => anchorRefs.set("capability", el)}>
              <CapabilityMenu
                value={props.capability}
                canGenerateVideo={props.canGenerateVideo}
                onSelect={(value) => { if (workspaceModeForCapability(value)) props.onToolClick?.(); props.onCapability(value); props.onOpenMenu(null) }}
              />
            </div>
          </Show>
          <Show when={isImageGeneration() && props.openMenu === "style"}>
            <div class="studio-composer-dropdown-anchor" ref={(el) => anchorRefs.set("style", el)}>
              <StyleMenu
                value={props.styleModel}
                canUseSeedream={props.canUseSeedream}
                onSelect={(value) => { props.onStyleModel(value); props.onOpenMenu(null) }}
              />
            </div>
          </Show>
          <Show when={isImageGeneration() && props.openMenu === "settings"}>
            <div class="studio-composer-dropdown-anchor" ref={(el) => anchorRefs.set("settings", el)}>
              <ImageSettings
                aspectRatio={props.aspectRatio}
                count={props.count}
                styleModel={props.styleModel}
                customWidth={props.customWidth}
                customHeight={props.customHeight}
                isCustom={props.isCustom}
                onAspectRatio={props.onAspectRatio}
                onCount={props.onCount}
                onCustomWidth={props.onCustomWidth}
                onCustomHeight={props.onCustomHeight}
                onIsCustom={props.onIsCustom}
              />
            </div>
          </Show>
          <Show when={isImageGeneration() && props.openMenu === "material" && props.wordBook}>
            <div class="studio-composer-dropdown-anchor" ref={(el) => anchorRefs.set("material", el)}>
              <MaterialMenu wordBook={props.wordBook!} onSelectTag={(tag) => props.onPrompt(props.prompt ? props.prompt + "，" + tag : tag)} />
            </div>
          </Show>
          <Show when={isVideoGeneration() && props.openMenu === "settings"}>
            <div class="studio-composer-dropdown-anchor" ref={(el) => anchorRefs.set("video-settings", el)}>
              <VideoSettings
                aspectRatio={props.aspectRatio}
                count={props.count}
                duration={props.videoDuration}
                qualityMode={props.videoQualityMode}
                qualityLocked={props.videoQualityLocked}
                onAspectRatio={props.onAspectRatio}
                onCount={props.onCount}
                onDuration={props.onVideoDuration}
                onQualityMode={props.onVideoQualityMode}
              />
            </div>
          </Show>
          <Show when={!isBusy()}>
            <button
              type="button"
              onClick={props.onSubmit}
              disabled={!props.canSubmit}
              class="studio-composer-send"
              title="生成"
            />
          </Show>
          <Show when={isBusy() && props.onCancel}>
            <button
              type="button"
              onClick={props.onCancel}
              class="studio-composer-stop"
              title="停止生成"
            />
          </Show>
        </div>
      </div>
      <div class="studio-composer-compliance">
        <span>遵守</span>
        <div class="studio-composer-compliance-guide">
          <button type="button" class="studio-composer-compliance-trigger">合规指引</button>
          <span>，</span>
          <div role="tooltip" class="studio-composer-compliance-tooltip">
            <StudioVideoRiskContent
              class="studio-composer-compliance-tooltip-content"
              isVideoGeneration={props.capability === "video.generate"}
            />
            <span class="studio-composer-compliance-tooltip-arrow" />
          </div>
        </div>
        <span>严禁上传内部敏感信息</span>
      </div>
    </div>
  )
}

function ToolButton(props: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; onPointerDown?: () => void }): JSX.Element {
  return (
    <button type="button" onPointerDown={props.onPointerDown} onClick={props.onClick} disabled={props.disabled} class="studio-composer-tool-btn" data-active={props.active ? "" : undefined}>
      <span class="studio-composer-tool-label">{props.label}</span>
      <span class="studio-composer-tool-caret" />
    </button>
  )
}

function IconTool(props: { label: string; title?: string; children?: JSX.Element; class?: string; disabled?: boolean; onClick?: () => void; onPointerDown?: () => void }): JSX.Element {
  const hasLabel = () => Boolean(props.children)
  const iconClass = () => {
    if (props.class) return props.class
    return props.label === "参数" ? "studio-composer-icon-settings" : "studio-composer-icon-material"
  }
  return (
    <button
      type="button"
      onPointerDown={props.onPointerDown}
      onClick={props.onClick}
      disabled={props.disabled}
      class={`studio-composer-icon-tool ${iconClass()}`}
      classList={{ "studio-composer-icon-tool--has-text": hasLabel() }}
      title={props.title ?? props.label}
      aria-label={props.label}
    >
      <Show when={hasLabel()} fallback={null}>
        <span class="studio-composer-icon-tool-label">{props.children}</span>
      </Show>
    </button>
  )
}

function VideoFrameButton(props: { label: string; asset?: StudioAsset; disabled?: boolean; onPick: () => void; onRemove: () => void }): JSX.Element {
  return (
    <div class="studio-composer-video-frame-wrap">
      <button
        type="button"
        onClick={props.onPick}
        disabled={props.disabled}
        class="studio-composer-video-frame"
        classList={{ filled: Boolean(props.asset) }}
        title={props.asset ? `替换${props.label}` : `上传${props.label}`}
      >
        <Show when={props.asset} fallback={
          <>
            <img src="/studio/studio_public_plus.svg" class="studio-composer-video-plus" alt="" />
            <span class="studio-composer-video-label">{props.label}</span>
          </>
        }>
          {(asset) => <img src={asset().dataUrl} alt={asset().name} class="studio-composer-video-image" />}
        </Show>
      </button>
      <Show when={props.asset}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove()
          }}
          disabled={props.disabled}
          class="studio-composer-video-remove"
          aria-label={`删除${props.label}`}
          title={`删除${props.label}`}
        >
          ×
        </button>
      </Show>
    </div>
  )
}

function CapabilityMenu(props: {
  value: StudioCapability
  canGenerateVideo: boolean
  onSelect: (value: StudioCapability) => void
}): JSX.Element {
  return (
    <div class="studio-menu w-[175px] p-1">
      <For each={STUDIO_CAPABILITIES
        .map((item, index) => ({ item, index }))
        .filter((entry) => entry.item.id !== "video.generate" || props.canGenerateVideo)}
      >
        {(entry) => (
          <>
            <button
              type="button"
              onClick={() => props.onSelect(entry.item.id)}
              disabled={!SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id)}
              class="studio-capability-option"
              classList={{
                active: entry.item.id === props.value,
                "opacity-45 cursor-not-allowed": !SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id),
              }}
              title={SUPPORTED_STUDIO_CAPABILITIES.has(entry.item.id) ? entry.item.description : "即将支持"}
            >
              <span class={`studio-capability-icon studio-capability-icon-${entry.index + 1}`} />
              <span class="studio-capability-label">{entry.item.label}</span>
            </button>
            <Show when={
              entry.item.id === (props.canGenerateVideo ? "video.generate" : "image.generate") ||
              entry.item.id === "image.outpaint"
            }>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 12px" }} />
            </Show>
          </>
        )}
      </For>
    </div>
  )
}

function StyleMenu(props: { value: string; canUseSeedream: boolean; onSelect: (value: string) => void }): JSX.Element {
  return (
    <div class="studio-menu w-[414px] p-4">
      <div class="text-[13px] font-semibold mb-3">风格模型</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <For each={STUDIO_STYLE_MODELS.filter((item) => item.requiresSeedreamPermission !== true || props.canUseSeedream)}>
          {(item) => {
            return (
              <button
                type="button"
                onClick={() => props.onSelect(item.id)}
                title={item.label}
                class="studio-style-option"
                classList={{ active: item.id === props.value }}
              >
                <span class="studio-style-icon">
                  <Show when={item.icon}>
                    {(icon) => <img src={icon()} alt="" aria-hidden="true" />}
                  </Show>
                </span>
                <span class="studio-style-label">{item.label}</span>
                <Show when={item.id === props.value}>
                  <span class="studio-style-check" />
                </Show>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function ImageSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  styleModel: string
  customWidth: number
  customHeight: number
  isCustom: boolean
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onCustomWidth: (value: number) => void
  onCustomHeight: (value: number) => void
  onIsCustom: (value: boolean) => void
}): JSX.Element {
  const isCustom = () => props.isCustom
  const setIsCustom = (v: boolean) => props.onIsCustom(v)
  const defaultDims = () => getDefaultDimensions(props.styleModel, props.aspectRatio)!
  const [width, setWidth] = createSignal(isCustom() ? props.customWidth : defaultDims().width)
  const [height, setHeight] = createSignal(isCustom() ? props.customHeight : defaultDims().height)
  // 关闭弹框时将当前宽高同步到父组件，确保 toolbar text 更新
  onCleanup(() => {
    if (!isCustom()) return
    const w = width(), h = height()
    if (w <= 0 || h <= 0) return
    if (isJimeng()) {
      const rW = jimengDimRange(w)
      const wValid = rW.min <= rW.max
      const rH = jimengDimRange(h)
      const hValid = rH.min <= rH.max
      if (!wValid || !hValid) { props.onIsCustom(false); return }
      const area = w * h
      const areaOk = area >= JIMENG_AREA_MIN && area <= JIMENG_AREA_MAX
      const ratioVal = w / h
      const ratioOk = ratioVal >= 1 / 16 && ratioVal <= 16
      if (!areaOk || !ratioOk) { props.onIsCustom(false); return }
    } else {
      const { min, max } = props.styleModel === "qwen" ? { min: 250, max: 1664 } : { min: 250, max: 2500 }
      if (w < min || w > max || h < min || h > max) { props.onIsCustom(false); return }
    }
    props.onCustomWidth(w)
    props.onCustomHeight(h)
  })
  createEffect(() => {
    if (isCustom()) return
    const dims = getDefaultDimensions(props.styleModel, props.aspectRatio)!
    setWidth(dims.width)
    setHeight(dims.height)
  })

  function tryMatchRatio(w: number, h: number) {
    if (!w || !h) return
    for (const r of STUDIO_ASPECT_RATIOS) {
      const dims = getDefaultDimensions(props.styleModel, r)!
      if (dims.width === w && dims.height === h) {
        setIsCustom(false)
        props.onIsCustom(false)
        if (r !== props.aspectRatio) props.onAspectRatio(r)
        return
      }
    }
    setIsCustom(true)
    props.onIsCustom(true)
  }

  const isJimeng = () => props.styleModel === "seedream-5-lite" || (getModelResolutionKey(props.styleModel) !== "default" && getModelResolutionKey(props.styleModel) !== "hdesign" && props.styleModel !== "qwen")
  const JIMENG_AREA_MIN = 2560 * 1440
  const JIMENG_AREA_MAX = Math.round(3072 * 3072 * 1.1025)

  function computeJimengDimMin(): number {
    for (let w = Math.ceil(Math.sqrt(JIMENG_AREA_MIN / 16)); ; w++) {
      if (Math.ceil(JIMENG_AREA_MIN / w) <= Math.floor(w * 16)) return w
    }
  }

  function computeJimengDimMax(): number {
    for (let w = Math.floor(Math.sqrt(JIMENG_AREA_MAX * 16)); ; w--) {
      if (Math.ceil(w / 16) <= Math.floor(JIMENG_AREA_MAX / w)) return w
    }
  }

  const JIMENG_DIM_MIN = computeJimengDimMin()
  const JIMENG_DIM_MAX = computeJimengDimMax()

  function jimengDimRange(dim: number): { min: number; max: number } {
    const minByArea = Math.ceil(JIMENG_AREA_MIN / dim)
    const maxByArea = Math.floor(JIMENG_AREA_MAX / dim)
    const minByRatio = Math.ceil(dim / 16)
    const maxByRatio = Math.floor(dim * 16)
    return {
      min: Math.max(minByArea, minByRatio),
      max: Math.min(maxByArea, maxByRatio),
    }
  }

  const sizeWarnText = () => {
    if (props.styleModel === "qwen") return "请输入有效数值250px ~ 1664px"
    if (isJimeng()) {
      const w = debouncedW(), h = debouncedH()
      // 只输入一个：仅超出绝对范围时提示
      if (w > 0 && h === 0) {
        if (w < JIMENG_DIM_MIN || w > JIMENG_DIM_MAX) {
          return `请输入有效数值${JIMENG_DIM_MIN}px ~ ${JIMENG_DIM_MAX}px`
        }
        return ""
      }
      if (h > 0 && w === 0) {
        if (h < JIMENG_DIM_MIN || h > JIMENG_DIM_MAX) {
          return `请输入有效数值${JIMENG_DIM_MIN}px ~ ${JIMENG_DIM_MAX}px`
        }
        return ""
      }
      // 都输入了，检查是否不匹配
      if (w > 0 && h > 0) {
        const r = jimengDimRange(w)
        if (h < r.min || h > r.max) {
          return "支持宽高乘积在 [2560×1440, 3072×3072×1.1025]，宽高比 1:16 ~ 16:1"
        }
        const r2 = jimengDimRange(h)
        if (w < r2.min || w > r2.max) {
          return "支持宽高乘积在 [2560×1440, 3072×3072×1.1025]，宽高比 1:16 ~ 16:1"
        }
        return ""
      }
      return ""
    }
    return "请输入有效数值250px ~ 2500px"
  }

  // 防抖取值：输入停止 600ms 后才更新用于校验的宽高
  const [debouncedW, setDebouncedW] = createSignal(width())
  const [debouncedH, setDebouncedH] = createSignal(height())
  let sizeDebounceTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const w = width()
    const h = height()
    clearTimeout(sizeDebounceTimer)
    sizeDebounceTimer = setTimeout(() => {
      batch(() => {
        setDebouncedW(w)
        setDebouncedH(h)
      })
    }, 600)
  })
  onCleanup(() => clearTimeout(sizeDebounceTimer))

  const sizeLimit = () => props.styleModel === "qwen" ? { min: 250, max: 1664 } : { min: 250, max: 2500 }

  // 用防抖后的值做校验
  const needsWarn = createMemo(() => {
    if (!isCustom()) return false
    const w = debouncedW()
    const h = debouncedH()
    if (isJimeng()) {
      // 只输入一个：仅当超出绝对范围时提示
      if (w > 0 && h === 0) return w < JIMENG_DIM_MIN || w > JIMENG_DIM_MAX
      if (h > 0 && w === 0) return h < JIMENG_DIM_MIN || h > JIMENG_DIM_MAX
      if (w === 0 && h === 0) return false
      const area = w * h
      if (area < JIMENG_AREA_MIN || area > JIMENG_AREA_MAX) return true
      const ratio = w / h
      if (ratio < 1 / 16 || ratio > 16) return true
      return false
    }
    // 非即梦模型：第一框不合法就提示，第二框空了也提示
    if (w === 0 && h === 0) return false
    const { min, max } = sizeLimit()
    if ((w > 0 && (w < min || w > max)) || (h > 0 && (h < min || h > max))) return true
    return false
  })

  function handleWidthInput(e: { currentTarget: HTMLInputElement }) {
    e.currentTarget.value = e.currentTarget.value.replace(/[^0-9]/g, "").replace(/^0+/, "")
    const val = parseInt(e.currentTarget.value) || 0
    const wasCustom = isCustom()
    setWidth(val)
    tryMatchRatio(val, height())
    // 从预设值切换到自定义时，清空另一个输入框的值
    if (!wasCustom && isCustom()) {
      setHeight(0)
    }
  }

  function handleHeightInput(e: { currentTarget: HTMLInputElement }) {
    e.currentTarget.value = e.currentTarget.value.replace(/[^0-9]/g, "").replace(/^0+/, "")
    const val = parseInt(e.currentTarget.value) || 0
    const wasCustom = isCustom()
    setHeight(val)
    tryMatchRatio(width(), val)
    // 从预设值切换到自定义时，清空另一个输入框的值
    if (!wasCustom && isCustom()) {
      setWidth(0)
    }
  }

  function handleSizeBlur(field: "w" | "h") {
    if (isJimeng()) {
      const w = width(), h = height()
      if (w === 0 || h === 0) return
      const rW = jimengDimRange(w)
      const rH = jimengDimRange(h)
      const wValid = rW.min <= rW.max
      const hValid = rH.min <= rH.max

      if (wValid && !hValid) {
        const clampedH = h < rW.min ? rW.min : rW.max
        setHeight(clampedH)
      } else if (!wValid && hValid) {
        const clampedW = w < rH.min ? rH.min : rH.max
        setWidth(clampedW)
      } else if (wValid && hValid) {
        if (field === "w") {
          if (w < rH.min || w > rH.max) {
            const clampedW = w < rH.min ? rH.min : rH.max
            setWidth(clampedW)
          }
        } else {
          if (h < rW.min || h > rW.max) {
            const clampedH = h < rW.min ? rW.min : rW.max
            setHeight(clampedH)
          }
        }
      }
      return
    }
    const { min, max } = sizeLimit()
    const w = width(), h = height()
    if (w === 0 || h === 0) return
    const wValid = w >= min && w <= max
    const hValid = h >= min && h <= max
    if (wValid && !hValid) {
      const clampedH = h < min ? min : max
      setHeight(clampedH)
    } else if (!wValid && hValid) {
      const clampedW = w < min ? min : max
      setWidth(clampedW)
    } else if (!wValid && !hValid) {
      // 都不合法，不处理
    }
    // 都合法，不处理
  }

  function clampJimengSize(field: "w" | "h") {
    let w = width(), h = height()
    if (!w || !h) return
    // Clamp area
    const area = w * h
    if (area < JIMENG_AREA_MIN) {
      const scale = Math.sqrt(JIMENG_AREA_MIN / area)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
    } else if (area > JIMENG_AREA_MAX) {
      const scale = Math.sqrt(JIMENG_AREA_MAX / area)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
    }
    // Clamp ratio
    const ratio = w / h
    if (ratio < 1 / 16) {
      w = Math.round(h / 16)
    } else if (ratio > 16) {
      h = Math.round(w / 16)
    }
    setWidth(w)
    setHeight(h)
    props.onCustomWidth(w)
    props.onCustomHeight(h)
  }

  function selectRatio(r: StudioAspectRatio) {
    setIsCustom(false)
    props.onIsCustom(false)
    props.onAspectRatio(r)
    props.onCustomWidth(0)
    props.onCustomHeight(0)
  }

  function selectCustom() {
    setIsCustom(true)
    setWidth(props.customWidth || 0)
    setHeight(props.customHeight || 0)
    props.onIsCustom(true)
  }

  // 弹框关闭或隐藏时，如果自定义尺寸为空，则重置为预设比例模式，
  // 确保下次打开弹框时默认选中上次选中的预设比例
  onCleanup(() => {
    if (isCustom()) {
      const w = width()
      const h = height()
      if (w === 0 || h === 0) {
        props.onIsCustom(false)
        props.onCustomWidth(0)
        props.onCustomHeight(0)
      }
    }
  })

  return (
    <div class="studio-menu studio-image-settings-menu">
      <div class="studio-image-settings-title">图片设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios">
        <For each={STUDIO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => selectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: !isCustom() && item === props.aspectRatio }}
              aria-pressed={!isCustom() && item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "--icon-w": item === "1:1" ? "20px" : item === "2:3" ? "12px" : item === "3:4" ? "14px" : item === "9:16" ? "10px" : "20px",
                  "--icon-h": item === "1:1" ? "20px" : item === "3:2" ? "12px" : item === "4:3" ? "14px" : item === "16:9" ? "10px" : "20px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
        <button
          type="button"
          class="studio-image-settings-ratio"
          classList={{ active: isCustom() || !STUDIO_ASPECT_RATIOS.includes(props.aspectRatio) }}
          aria-pressed={isCustom() || !STUDIO_ASPECT_RATIOS.includes(props.aspectRatio)}
          onClick={() => selectCustom()}
        >
          <span
            class="studio-image-settings-ratio-icon custom"
            style={{ "--icon-w": "20px", "--icon-h": "20px" }}
          >
            <span class="studio-image-settings-ratio-icon-l" />
          </span>
          <span class="studio-image-settings-ratio-text">自定义</span>
        </button>
      </div>
      <div class="studio-image-settings-label">图片数量</div>
      <div class="studio-image-settings-counts">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
              aria-pressed={item === props.count}
            >
              {item}张
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label" style={{ "margin-top": "16px" }}>
        尺寸
        <span class="studio-image-settings-size-warn" title={sizeWarnText()} style={{ visibility: needsWarn() ? "visible" : "hidden" }} />
        <span class="studio-image-settings-size-warn-text" style={{ visibility: needsWarn() ? "visible" : "hidden" }}>{sizeWarnText()}</span>
      </div>
      <div class="studio-image-settings-size">
        <div class="studio-image-settings-size-input">
          <span class="studio-image-settings-size-label">W</span>
          <input type="number" class="studio-image-settings-size-field" placeholder="宽" step="1" inputmode="numeric" value={width() || ""} onInput={handleWidthInput} onBlur={() => handleSizeBlur("w")} />
        </div>
        <div class="studio-image-settings-size-input">
          <span class="studio-image-settings-size-label">H</span>
          <input type="number" class="studio-image-settings-size-field" placeholder="高" step="1" inputmode="numeric" value={height() || ""} onInput={handleHeightInput} onBlur={() => handleSizeBlur("h")} />
        </div>
        <span class="studio-image-settings-size-unit">PX</span>
      </div>
    </div>
  )
}

function VideoSettings(props: {
  aspectRatio: StudioAspectRatio
  count: 1 | 2 | 3 | 4
  duration: StudioVideoDuration
  qualityMode: StudioVideoQualityMode
  qualityLocked: boolean
  onAspectRatio: (value: StudioAspectRatio) => void
  onCount: (value: 1 | 2 | 3 | 4) => void
  onDuration: (value: StudioVideoDuration) => void
  onQualityMode: (value: StudioVideoQualityMode) => void
}): JSX.Element {
  return (
    <div class="studio-menu studio-image-settings-menu studio-video-settings-menu">
      <div class="studio-image-settings-title">视频设置</div>
      <div class="studio-image-settings-label">选择比例</div>
      <div class="studio-image-settings-ratios studio-video-settings-ratios">
        <For each={STUDIO_VIDEO_ASPECT_RATIOS}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onAspectRatio(item)}
              class="studio-image-settings-ratio"
              classList={{ active: item === props.aspectRatio }}
              aria-pressed={item === props.aspectRatio}
            >
              <span
                class="studio-image-settings-ratio-icon"
                style={{
                  "--icon-w": item === "1:1" ? "20px" : item === "9:16" ? "10px" : "20px",
                  "--icon-h": item === "1:1" ? "20px" : item === "16:9" ? "10px" : "20px",
                }}
              />
              <span class="studio-image-settings-ratio-text">{item}</span>
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频时长</div>
      <div class="studio-image-settings-counts studio-video-settings-duration">
        <For each={["5", "10"] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onDuration(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.duration }}
              aria-pressed={item === props.duration}
            >
              {item}秒
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">视频数量</div>
      <div class="studio-image-settings-counts studio-video-settings-count">
        <For each={[1, 2, 3, 4] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onCount(item)}
              class="studio-image-settings-count"
              classList={{ active: item === props.count }}
              aria-pressed={item === props.count}
            >
              {item}条
            </button>
          )}
        </For>
      </div>
      <div class="studio-image-settings-label">生成模式</div>
      <div class="studio-image-settings-counts studio-video-settings-quality">
        <For each={[
          { label: "标准模式", value: "std" },
          { label: "高质量模式", value: "pro" },
        ] as const}>
          {(item) => (
            <button
              type="button"
              onClick={() => props.onQualityMode(item.value)}
              disabled={props.qualityLocked}
              class="studio-image-settings-count"
              classList={{ active: item.value === props.qualityMode }}
              aria-pressed={item.value === props.qualityMode}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
