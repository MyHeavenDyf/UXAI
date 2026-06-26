import { createSignal, onCleanup, For, Show } from "solid-js"
import type { VersionEntry } from "../../utils/persist"
import {
  IconActionDownload,
  IconActionShare,
  IconRefresh,
  IconChevronDown,
  IconCanvasHand,
  IconPageCursor,
  IconCenterReset,
  IconEditPencil,
  IconHistoryClock,
  IconSun,
  IconMoon,
} from "../icons"
import "../../assets/style/preview/titleBar.css"

interface DropdownItem {
  label: string
  value: string
}

interface TitleBarProps {
  canvasMode: boolean
  onToggleCanvasMode: () => void
  onReset: () => void
  onRefresh: () => void
  onFullscreen: () => void
  onDownload?: () => void
  onShare?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
  onOptionChange: (type: "preview" | "device" | "zoom" | "theme", value: string) => void

  // 容错升级：将这两个属性改成可选属性（加上 ?），防止其他文件调用时不传参数导致崩溃
  editing?: boolean
  onToggleEditing?: () => void
}

export function TitleBar(props: TitleBarProps) {
  // === 下拉菜单数据源控制 ===
  const previewOptions: DropdownItem[] = [
    { label: "实时预览", value: "live" },
    { label: "Pixso预览", value: "pixso" }
  ]

  const deviceOptions: DropdownItem[] = [
    { label: "桌面端 (1920×1080)", value: "desktop" },
    { label: "平板端 (768×1024)", value: "tablet" },
    { label: "手机端 (375×667)", value: "mobile" }
  ]

  const deviceLabelMap: Record<string, string> = { desktop: "桌面", tablet: "平板", mobile: "手机" }
  const [deviceLabel, setDeviceLabel] = createSignal("桌面")

  const zoomOptions: DropdownItem[] = [
    { label: "50%", value: "50" },
    { label: "100%", value: "100" },
    { label: "150%", value: "150" },
    { label: "200%", value: "200" }
  ]

  const [zoomLabel, setZoomLabel] = createSignal("100%")
  const [openPreview, setOpenPreview] = createSignal(false)
  const [openDesktop, setOpenDesktop] = createSignal(false)
  const [openZoom, setOpenZoom] = createSignal(false)

  // === 管理太阳/月亮主题的内部状态（默认白天 false） ===
  const [isDarkMode, setIsDarkMode] = createSignal(false)

  const [showHistory, setShowHistory] = createSignal(false)

  // 点击外部自动收起
  const closeAllDropdowns = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('.dropdown-trigger-container')) {
      setOpenPreview(false)
      setOpenDesktop(false)
      setOpenZoom(false)
      setShowHistory(false)
    }
  }
  window.addEventListener("click", closeAllDropdowns)
  onCleanup(() => window.removeEventListener("click", closeAllDropdowns))

  // 统一的点击处理函数
  function handleItemClick(type: "preview" | "device" | "zoom", value: string) {
    setOpenPreview(false)
    setOpenDesktop(false)
    setOpenZoom(false)
    setShowHistory(false)
    if (type === "device") setDeviceLabel(deviceLabelMap[value] ?? "桌面")
    if (type === "zoom") {
      const item = zoomOptions.find((o) => o.value === value)
      if (item) setZoomLabel(item.label)
    }
    props.onOptionChange(type, value)
  }

  // === 处理主题切换的交互逻辑 ===
  function toggleThemeMode() {
    const nextMode = !isDarkMode()
    setIsDarkMode(nextMode)
    props.onOptionChange("theme", nextMode ? "dark" : "light")
  }

  return (
    <div class="titlebar-wrapper">
      {/* ================= 第一排：56px 业务导航 ================= */}
      {/* <div class="titlebar-row-first">
        <div class="business-btn-group">
          
          <div class="btn-with-divider">
            <button class="business-nav-btn btn-default">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <span>界面设计</span>
            </button>
            <div class="btn-vertical-divider" />
          </div>
          
          <button class="business-nav-btn btn-light-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>开发页面原型</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div> */}

      {/* ================= 第二排：画布工具栏 ================= */}
      <div class="titlebar-row-second">
        
        {/* 左边：刷新和 3 个带有精密间距控制的无边框下拉菜单 */}
        <div class="toolbar-flex-left">
          <button class="preview-action-icon-btn" title="刷新页面" onClick={() => props.onRefresh()}>
            <IconRefresh size={14} />
          </button>

          {/* 刷新按钮与预览之间的垂直分割小竖线 */}
          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 2px 0 6px" }} />
          
          {/* 下拉 1：预览 */}
          <div class={`dropdown-trigger-container ${openPreview() ? 'active-open' : ''}`}>
            <button class="dropdown-borderless-btn" onClick={() => { setOpenPreview(!openPreview()); setOpenDesktop(false); setOpenZoom(false); setShowHistory(false) }}>
              <span>预览</span>
              <IconChevronDown size={12} />
            </button>
            {openPreview() && (
              <div class="dropdown-menu-panel">
                <For each={previewOptions}>
                  {(item) => (
                    <button class="dropdown-menu-item" onClick={() => handleItemClick("preview", item.value)}>
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </div>

          {/* 🛠️ 修改点 2：微调预览与桌面之间的边距 */}
          <div class="btn-vertical-divider" style={{ height: "10px" }} />

          {/* 下拉 2：桌面 */}
          <div class={`dropdown-trigger-container ${openDesktop() ? 'active-open' : ''}`}>
            <button class="dropdown-borderless-btn" onClick={() => { setOpenDesktop(!openDesktop()); setOpenPreview(false); setOpenZoom(false); setShowHistory(false) }}>
              <span>{deviceLabel()}</span>
              <IconChevronDown size={12} />
            </button>
            {openDesktop() && (
              <div class="dropdown-menu-panel">
                <For each={deviceOptions}>
                  {(item) => (
                    <button class="dropdown-menu-item" onClick={() => handleItemClick("device", item.value)}>
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </div>

          {/* 🛠️ 修改点 3：微调桌面与 100% 之间的边距 */}
          <div class="btn-vertical-divider" style={{ height: "10px" }} />

          {/* 下拉 3：100% 缩放 */}
          <div class={`dropdown-trigger-container ${openZoom() ? 'active-open' : ''}`}>
            <button class="dropdown-borderless-btn" onClick={() => { setOpenZoom(!openZoom()); setOpenPreview(false); setOpenDesktop(false); setShowHistory(false) }}>
              <span>{zoomLabel()}</span>
              <IconChevronDown size={12} />
            </button>
            {openZoom() && (
              <div class="dropdown-menu-panel">
                <For each={zoomOptions}>
                  {(item) => (
                    <button class="dropdown-menu-item" onClick={() => handleItemClick("zoom", item.value)}>
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </div>

        </div>

        {/* 右边：常驻控制按钮组 */}
        <div class="toolbar-flex-right">
          {/* 按钮 1：画布模式切换 */}
          <button 
            class={`preview-action-icon-btn ${props.canvasMode ? 'mode-active' : ''}`} 
            title={props.canvasMode ? "当前：画布模式（可自由拖拽缩放）" : "当前：页面操作模式（可触发内层交互）"}
            onClick={() => props.onToggleCanvasMode()}
          >
            {props.canvasMode ? <IconCanvasHand size={16} /> : <IconPageCursor size={16} />}
          </button>

          {/* 按钮 2：居中复位 */}
          <button class="preview-action-icon-btn" title="居中复位" onClick={() => props.onReset()}>
            <IconCenterReset size={16} />
          </button>
          
          {/* 🛠️ 终极彻底修复：使用 SolidJS 原生 classList 来进行高权重的状态映射校验 */}
          <button 
            class="preview-action-icon-btn" 
            classList={{ 'edit-active': !!props.editing }}
            title="编辑"
            onClick={() => props.onToggleEditing?.()}
            style={{
              "color": (props.editing ?? false) ? "#3b82f6 !important" : "#666"
            }}
          >
            <IconEditPencil size={16} />
          </button>

          {/* 按钮 4：历史版本 */}
          <div class="dropdown-trigger-container">
            <button class="preview-action-icon-btn" title="历史版本" onClick={() => { setShowHistory(!showHistory()); setOpenPreview(false); setOpenDesktop(false); setOpenZoom(false) }}>
              <IconHistoryClock size={16} />
            </button>
            <Show when={showHistory()}>
              <div class="history-dropdown-panel">
                <Show
                  when={(props.versions?.length ?? 0) > 0}
                  fallback={
                    <div class="history-empty">暂无历史版本</div>
                  }
                >
                  <For each={[...(props.versions ?? [])].reverse()}>
                    {(v) => (
                      <button
                        class="history-dropdown-item"
                        onClick={() => {
                          props.onSelectVersion?.(v.id)
                          setShowHistory(false)
                        }}
                      >
                        <span class="history-dot" data-active={v.id === props.currentVersionId ? "" : undefined}>
                          {v.id === props.currentVersionId ? "●" : "○"}
                        </span>
                        <span class="history-time">
                          {new Date(v.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span class="history-summary" title={v.summary}>{v.summary}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          {/* 按钮 5：主题切换 */}
          <button 
            class="preview-action-icon-btn" 
            title={isDarkMode() ? "切换为白天模式" : "切换为暗黑模式"} 
            onClick={toggleThemeMode}
          >
            {isDarkMode() ? <IconSun size={16} /> : <IconMoon size={16} />}
          </button>

          {/* 下载前的垂直分割线 */}
          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 8px" }} />

          {/* 按钮：分享 */}
          <button class="preview-action-icon-btn" title="分享" onClick={() => props.onShare?.()}>
            <IconActionShare size={16} />
          </button>

          {/* 按钮 6：下载 */}
          <button class="preview-action-icon-btn" title="下载" onClick={() => props.onDownload?.()}>
            <IconActionDownload size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}