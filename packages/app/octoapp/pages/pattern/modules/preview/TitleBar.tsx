import { createSignal, onCleanup, For, Show } from "solid-js"
import type { VersionEntry } from "../../utils/persist"

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
    { label: "分享链接", value: "share" }
  ]

  const deviceOptions: DropdownItem[] = [
    { label: "桌面端 (1920x1080)", value: "desktop" },
    { label: "平板端 (768x1024)", value: "tablet" },
    { label: "手机端 (375x667)", value: "mobile" }
  ]

  const zoomOptions: DropdownItem[] = [
    { label: "50%", value: "50" },
    { label: "100%", value: "100" },
    { label: "150%", value: "150" },
    { label: "200%", value: "200" }
  ]

  // === 独立控制三个下拉菜单的显示/隐藏状态 ===
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
      <div class="titlebar-row-first">
        <div class="business-btn-group">
          
          {/* 按钮 1：文件图标 + 右侧竖线 */}
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

          {/* 按钮 2：浅蓝背景 + 蓝色编辑和差图标 */}
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
      </div>

      {/* ================= 第二排：画布工具栏 ================= */}
      <div class="titlebar-row-second">
        
        {/* 左边：刷新和 3 个带有精密间距控制的无边框下拉菜单 */}
        <div class="toolbar-flex-left">
          <button class="preview-action-icon-btn" title="刷新页面" onClick={() => props.onRefresh()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>

          {/* 刷新按钮与预览之间的垂直分割小竖线 */}
          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 2px 0 6px" }} />
          
          {/* 下拉 1：预览 */}
          <div class={`dropdown-trigger-container ${openPreview() ? 'active-open' : ''}`}>
            <button class="dropdown-borderless-btn" onClick={() => { setOpenPreview(!openPreview()); setOpenDesktop(false); setOpenZoom(false); setShowHistory(false) }}>
              <span>预览</span>
              <svg class="arrow-polyline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
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
              <span>桌面</span>
              <svg class="arrow-polyline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
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
              <span>100%</span>
              <svg class="arrow-polyline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
              {props.canvasMode ? (
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a2 2 0 114 0v4m0 0V9a2 2 0 114 0v2m0 0v-1a2 2 0 114 0v3a7 7 0 11-14 0v-4a2 2 0 114 0v3" />
              ) : (
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4l7.14 16.29a.5.5 0 00.93-.16l2.19-6.42 6.42-2.19a.5.5 0 00.16-.93L4 4z" />
              )}
            </svg>
          </button>

          {/* 按钮 2：居中复位 */}
          <button class="preview-action-icon-btn" title="居中复位" onClick={() => props.onReset()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
              <circle cx="12" cy="12" r="3" stroke-width="2"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
            </svg>
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
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path 
                d="M12 20h9" 
                stroke="currentColor" 
                stroke-width="2" 
                stroke-linecap="round" 
                stroke-linejoin="round"
              />
              <path 
                d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" 
                stroke="currentColor" 
                stroke-width="2" 
                stroke-linecap="round" 
                stroke-linejoin="round"
              />
            </svg>
          </button>

          {/* 按钮 4：历史版本 */}
          <div class="dropdown-trigger-container">
            <button class="preview-action-icon-btn" title="历史版本" onClick={() => { setShowHistory(!showHistory()); setOpenPreview(false); setOpenDesktop(false); setOpenZoom(false) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
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
                        <span class="history-summary">{v.summary}</span>
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
            {isDarkMode() ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>

          {/* 下载前的垂直分割线 */}
          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 8px" }} />

          {/* 按钮 6：下载 */}
          <button class="preview-action-icon-btn" title="下载" onClick={() => props.onDownload?.()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
              <path id="矢量 822" d="M9.08333 14.4C9.21667 14.5222 9.35833 14.6111 9.50833 14.6667C9.66389 14.7278 9.82778 14.7583 10 14.7583C10.1722 14.7583 10.3361 14.7278 10.4917 14.6667C10.6417 14.6111 10.7833 14.5222 10.9167 14.4L14.8167 10.4833L14.8583 10.4417C14.9639 10.3083 15.0139 10.1611 15.0083 9.99999C15.0028 9.83888 14.9389 9.70555 14.8167 9.59999C14.7111 9.49444 14.5778 9.43888 14.4167 9.43332C14.2611 9.42221 14.1167 9.46388 13.9833 9.55832L13.9417 9.59999L10.6167 12.8583L10.6167 2.39999C10.6167 2.22777 10.5583 2.08055 10.4417 1.95833C10.3194 1.84166 10.1722 1.78333 10 1.78333C9.82778 1.78333 9.68056 1.84166 9.55833 1.95833C9.44167 2.08055 9.38333 2.22777 9.38333 2.39999L9.38333 12.9L6.05833 9.59999C5.95278 9.47777 5.81389 9.41666 5.64167 9.41666C5.46944 9.41666 5.32222 9.47777 5.2 9.59999C5.06667 9.72221 5 9.86944 5 10.0417C5 10.2139 5.06667 10.3611 5.2 10.4833L9.08333 14.4Z" fill="rgb(25,25,25)" fill-rule="nonzero"></path>
              <path id="矢量 823" d="M17.7167 12.7416C17.5444 12.7416 17.4 12.8 17.2833 12.9166C17.1611 13.0389 17.1 13.1861 17.1 13.3583L17.1 15.1C17.1 15.6055 16.9167 16.0416 16.55 16.4083C16.1833 16.775 15.7389 16.9583 15.2167 16.9583L4.78333 16.9583C4.27221 16.9583 3.83055 16.775 3.45833 16.4083C3.0861 16.0416 2.89999 15.6055 2.89999 15.1L2.89999 13.3833C2.89999 13.2055 2.83888 13.0583 2.71666 12.9416C2.59999 12.8194 2.45555 12.7583 2.28333 12.7583C2.10555 12.7583 1.95833 12.8194 1.84166 12.9416C1.71944 13.0583 1.65833 13.2055 1.65833 13.3833L1.65833 15.1C1.65833 15.6611 1.79999 16.1805 2.08333 16.6583C2.3611 17.1416 2.73888 17.5222 3.21666 17.8C3.69999 18.0778 4.22221 18.2166 4.78333 18.2166L15.2167 18.2166C15.7944 18.2166 16.3222 18.0778 16.8 17.8C17.2778 17.5222 17.6583 17.1416 17.9417 16.6583C18.2194 16.1805 18.3583 15.6611 18.3583 15.1L18.3583 13.3583C18.3583 13.1861 18.2944 13.0389 18.1667 12.9166C18.0444 12.8 17.8944 12.7416 17.7167 12.7416Z" fill="rgb(25,25,25)" fill-rule="nonzero"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}