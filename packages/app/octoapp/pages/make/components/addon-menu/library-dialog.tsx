import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import {
  assetFileId,
  encodeAssetUrl,
  getAssetThumb,
  isAssetThumbImage,
  joinUrl,
  type AssetFile,
} from "./asset-library"
import type { MenuSelection } from "./types"
import { tracker } from "@/utils/tracker"

/**
 * 资产库弹窗
 */

interface PlatformAsset {
  label: string
  id: number | string
  enable: boolean
}

export interface LibraryDialogProps {
  open: boolean
  productId?: number
  selections: MenuSelection[]
  onSelect: (selection: MenuSelection) => void
  onDeselect: (selection: MenuSelection) => void
  onConfirm: (selectedFiles: AssetFile[]) => void
  onCancel: () => void
  trackerModule?: string
}

function buildAssetSelection(file: AssetFile): MenuSelection {
  const isZip = (file.versionInfo?.[0]?.fileName ?? "").toLowerCase().endsWith(".zip")
  return {
    type: "file",
    filename: file.fileName,
    path: assetFileId(file),
    isFolder: isZip || undefined,
    realPathName: file.realPathName,
  }
}

function rawAssetId(chipId: string): number | string {
  const raw = chipId.startsWith("asset-") ? chipId.slice("asset-".length) : chipId
  const num = Number(raw)
  return Number.isFinite(num) && `${num}` === raw ? num : raw
}

export function LibraryDialog(props: LibraryDialogProps): JSX.Element {
  return (
    <Show when={props.open}>
      <LibraryDialogInner {...props} />
    </Show>
  )
}

function LibraryDialogInner(props: LibraryDialogProps): JSX.Element {
  const [tab, setTab] = createSignal<"platform" | "product">("platform")
  // iframe→parent 同步过来的选中态
  const [platformAssets, setPlatformAssets] = createSignal<PlatformAsset[]>([])
  const [productSelected, setProductSelected] = createSignal<Map<string, AssetFile>>(new Map())
  const [platformPanelOpen, setPlatformPanelOpen] = createSignal(false)
  const [productPanelOpen, setProductPanelOpen] = createSignal(false)
  // 面板打开瞬间的行快照
  const [platformPanelRows, setPlatformPanelRows] = createSignal<PlatformAsset[]>([])

  let platformIframeRef: HTMLIFrameElement | undefined
  let productIframeRef: HTMLIFrameElement | undefined
  let iniRetryTimer: ReturnType<typeof setTimeout> | undefined

  const base = import.meta.env.VITE_OCTO_BASE_URL || ""
  const allowedOrigin = base ? new URL(base).origin : ""
  const platformSrc = base ? `${base}/designAssets/skillLibrary/#/resourcePage` : ""
  const productSrc = base && props.productId ? `${base}/agentPage/asset-modal/${props.productId}?ts=${Date.now()}` : ""

  const postToIframe = (iframe: HTMLIFrameElement | undefined, payload: unknown) => {
    iframe?.contentWindow?.postMessage(payload, allowedOrigin || "*")
  }

  // ── chip 构造/匹配 ──
  const isChipSelected = (id: string) =>
    props.selections.some(s => s.type === "file" && (s as any).id === id)

  const assetChipIds = () =>
    props.selections
      .filter(s => s.type === "file" && typeof (s as any).id === "string" && ((s as any).id as string).startsWith("asset-"))
      .map(s => (s as any).id as string)

  // 打开时 iframe 尚无选中态:doc 里的 asset chip 回传给 iframe 回显
  // (本弹窗创建过的 chip 有完整缓存数据,其余只传 {id, fileName, realPathName})
  const initialIniList = (): unknown[] => {
    const known = productSelected()
    return assetChipIds().map(id => {
      const file = known.get(id)
      if (file) return { ...file }
      const sel = props.selections.find(s => s.type === "file" && (s as any).id === id) as
        | { filename?: string; realPathName?: string }
        | undefined
      return { id: rawAssetId(id), fileName: sel?.filename, realPathName: sel?.realPathName }
    })
  }

  const sendIniSelection = (list: unknown[]) => {
    postToIframe(productIframeRef, { type: "initPickerSelection", data: list })
  }

  // iframe onLoad 后回显已选;无 ready 握手,短重试兜底页面脚本晚于 load 注册监听的情况
  const scheduleIniSelection = () => {
    if (iniRetryTimer) clearTimeout(iniRetryTimer)
    let attempts = 0
    const send = () => {
      if (!productIframeRef) return
      sendIniSelection(initialIniList())
      if (++attempts < 3) iniRetryTimer = setTimeout(send, 300)
    }
    iniRetryTimer = setTimeout(send, 300)
  }

  // ── iframe→parent ──
  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== platformIframeRef?.contentWindow && event.source !== productIframeRef?.contentWindow) return
      if (allowedOrigin && event.origin !== allowedOrigin) return
      const payload = event.data as { type?: string; data?: unknown } | null
      if (!payload?.type) return

      if (payload.type === "assetsList") {
        // 平台资产:data 为 JSON 字符串
        try {
          const list = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data
          if (Array.isArray(list)) setPlatformAssets(list as PlatformAsset[])
        } catch {
          // 非法 JSON 忽略
        }
        return
      }

      if (payload.type === "assetPickerChange") {
        // 产品资产:data 为完整 AssetFile 数组
        const list = Array.isArray(payload.data) ? (payload.data as AssetFile[]) : []
        const next = new Map<string, AssetFile>()
        for (const file of list) {
          const id = assetFileId(file)
          next.set(id, file)
          if (!isChipSelected(id)) {
            props.onSelect(buildAssetSelection(file))
            tracker.interaction({ module: props.trackerModule ?? "design", name: "addon-select-library-asset", extend: JSON.stringify({ fileName: file.fileName }) })
          }
        }
        // iframe 已取消选中的 chip 同步移除(含打开前已存在的 chip:iframe 是选中态的唯一事实源)
        for (const sel of props.selections) {
          if (sel.type !== "file") continue
          const id = (sel as any).id as string | undefined
          if (id && id.startsWith("asset-") && !next.has(id)) props.onDeselect(sel)
        }
        setProductSelected(next)
      }
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => {
      window.removeEventListener("message", onMessage)
      if (iniRetryTimer) clearTimeout(iniRetryTimer)
    })
  })

  // ── 平台 tab:开关切换──
  const togglePlatformAsset = (asset: PlatformAsset) => {
    const enable = !asset.enable
    setPlatformAssets(prev => prev.map(a => (a.id === asset.id && a.label === asset.label ? { ...a, enable } : a)))
    setPlatformPanelRows(prev => prev.map(a => (a.id === asset.id && a.label === asset.label ? { ...a, enable } : a)))
    postToIframe(platformIframeRef, { type: "assetsList", data: JSON.stringify([{ label: asset.label, id: asset.id, enable }]) })
    tracker.interaction({ module: props.trackerModule ?? "design", name: "addon-toggle-platform-asset", extend: JSON.stringify({ label: asset.label, enable }) })
  }

  const openPlatformPanel = () => {
    setPlatformPanelRows(platformAssets().filter(a => a.enable))
    setPlatformPanelOpen(v => !v)
    setProductPanelOpen(false)
  }

  const platformCount = () => platformAssets().filter(a => a.enable).length

  // ── 产品 tab:面板移除/清空(spec line 283-291)──
  const removeProductAsset = (file: AssetFile) => {
    const id = assetFileId(file)
    const sel = props.selections.find(s => s.type === "file" && (s as any).id === id)
    if (sel) props.onDeselect(sel)
    const next = new Map(productSelected())
    next.delete(id)
    setProductSelected(next)
    sendIniSelection([...next.values()])
  }

  const clearProductAssets = () => {
    for (const [, file] of productSelected()) {
      const id = assetFileId(file)
      const sel = props.selections.find(s => s.type === "file" && (s as any).id === id)
      if (sel) props.onDeselect(sel)
    }
    setProductSelected(new Map())
    sendIniSelection([])
  }

  const openProductPanel = () => {
    setProductPanelOpen(v => !v)
    setPlatformPanelOpen(false)
  }

  // 确认:收集"未下载"(chip path === id)的选中文件
  const collectUndownloaded = (): AssetFile[] => {
    const result: AssetFile[] = []
    for (const [id, file] of productSelected()) {
      const sel = props.selections.find(s => s.type === "file" && (s as any).id === id)
      if (!sel) continue
      if ((sel as any).path !== id) continue
      result.push(file)
    }
    return result
  }

  // 已选面板点击外部关闭
  createEffect(() => {
    if (!platformPanelOpen() && !productPanelOpen()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(".library-selected-popover")) return
      if (target.closest(".asset-selected-trigger")) return
      setPlatformPanelOpen(false)
      setProductPanelOpen(false)
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  const productName = (file: AssetFile) => (file.realPathName ? `${file.realPathName}/${file.fileName}` : file.fileName)

  return (
    <Portal>
      <div class="asset-dialog-overlay">
        <div class="library-dialog" onClick={(e) => e.stopPropagation()}>
          {/* 标题栏 */}
          <div class="asset-dialog-title">
            <span class="asset-dialog-title-text">资产库</span>
            <button type="button" class="addon-menu-url-close asset-dialog-close" onClick={props.onCancel} aria-label="关闭">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          {/* tab 区 + 每 tab 独立的已选n项*/}
          <div class="library-dialog-tabrow">
            <button
              type="button"
              class={`library-dialog-tab ${tab() === "platform" ? "library-dialog-tab--active" : ""}`}
              onClick={() => setTab("platform")}
            >
              平台资产
            </button>
            <button
              type="button"
              class={`library-dialog-tab ${tab() === "product" ? "library-dialog-tab--active" : ""}`}
              onClick={() => setTab("product")}
            >
              产品资产
            </button>
            <div class="library-dialog-tabrow-spacer" />
            <Show
              when={tab() === "platform"}
              fallback={
                <button
                  type="button"
                  class={`asset-selected-trigger ${productPanelOpen() ? "asset-selected-trigger--active" : ""}`}
                  onClick={openProductPanel}
                >
                  已选{productSelected().size}项
                  <Icon
                    name="chevron-down"
                    size="small"
                    class="asset-selected-trigger-arrow"
                    style={productPanelOpen() ? "transform: rotate(180deg)" : undefined}
                  />
                </button>
              }
            >
              <button
                type="button"
                class={`asset-selected-trigger ${platformPanelOpen() ? "asset-selected-trigger--active" : ""}`}
                onClick={openPlatformPanel}
              >
                已选{platformCount()}项
                <Icon
                  name="chevron-down"
                  size="small"
                  class="asset-selected-trigger-arrow"
                  style={platformPanelOpen() ? "transform: rotate(180deg)" : undefined}
                />
              </button>
            </Show>

            {/* 平台资产已选面板(触发按钮下方,右缘对齐,宽 50%) */}
            <Show when={platformPanelOpen()}>
              <div class="library-selected-popover">
                <div class="asset-selected-popover-header">
                  <span class="asset-selected-popover-count">已选{platformCount()}项</span>
                </div>
                <div class="asset-selected-list">
                  <Show
                    when={platformPanelRows().length > 0}
                    fallback={<div class="asset-selected-empty">暂无内容</div>}
                  >
                    <For each={platformPanelRows()}>
                      {(asset) => (
                        <div class="library-selected-platform-item">
                          <span class="library-selected-platform-label" title={asset.label}>{asset.label}</span>
                          <Switch checked={asset.enable} onChange={() => togglePlatformAsset(asset)} hideLabel />
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

            {/* 产品资产已选面板(同附件面板已选列表,标题带 realPathName 完整路径) */}
            <Show when={productPanelOpen()}>
              <div class="library-selected-popover">
                <div class="asset-selected-popover-header">
                  <span class="asset-selected-popover-count">已选{productSelected().size}项</span>
                  <button type="button" class="asset-selected-clear" onClick={clearProductAssets}>清空</button>
                </div>
                <div class="asset-selected-list">
                  <Show
                    when={productSelected().size > 0}
                    fallback={<div class="asset-selected-empty">暂无内容</div>}
                  >
                    <For each={[...productSelected().entries()]}>
                      {([id, file]) => (
                        <div class="asset-selected-item">
                          <div class="asset-selected-thumb">
                            <Show when={file.type === 40} fallback={
                              <Show when={file.snapshot}>
                                <img src={encodeAssetUrl(joinUrl(file.s3BaseUrl, file.snapshot))} alt="" draggable={false} />
                              </Show>
                            }>
                              <Show when={getAssetThumb(file)}>
                                <img
                                  class={isAssetThumbImage(file) ? "asset-selected-full" : "asset-grid-icon"}
                                  src={getAssetThumb(file)}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
                            </Show>
                          </div>
                          <span class="asset-selected-name" title={productName(file)}>{productName(file)}</span>
                          <button
                            type="button"
                            class="asset-selected-remove"
                            onClick={() => removeProductAsset(file)}
                            aria-label="移除"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          {/* iframe 区(border-top + margin-top 16,双 iframe 常挂载保状态) */}
          <div class="library-dialog-iframe-area">
            <Show when={platformSrc}>
              <iframe
                ref={(el) => (platformIframeRef = el)}
                src={platformSrc}
                class="library-dialog-iframe"
                style={{ display: tab() === "platform" ? "block" : "none" }}
                title="平台资产"
              />
            </Show>
            <Show when={productSrc} fallback={
              <div class="library-dialog-iframe" style={{ display: tab() === "product" ? "flex" : "none", "align-items": "center", "justify-content": "center", "font-size": "14px", color: "#777" }}>
                请先选择关联产品的项目
              </div>
            }>
              <iframe
                ref={(el) => (productIframeRef = el)}
                src={productSrc}
                class="library-dialog-iframe"
                style={{ display: tab() === "product" ? "block" : "none" }}
                title="产品资产"
                onLoad={scheduleIniSelection}
              />
            </Show>
          </div>

          {/* 底部取消/确认:只产品资产 tab 有,右下角) */}
          <Show when={tab() === "product"}>
            <div class="library-dialog-footer">
              <div class="asset-dialog-footer-actions">
                <button type="button" class="asset-dialog-btn" onClick={props.onCancel}>取消</button>
                <button
                  type="button"
                  class="asset-dialog-btn asset-dialog-btn-primary"
                  onClick={() => {
                    const selected = collectUndownloaded()
                    tracker.interaction({ module: props.trackerModule ?? "design", name: "addon-confirm-library-asset", extend: JSON.stringify({ count: selected.length }) })
                    props.onConfirm(selected)
                  }}
                >
                  确认
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  )
}
