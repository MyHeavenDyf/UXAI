/**
 * 3D 预览页工具栏（参考 pattern title-bar.tsx，UI 风格一致）。
 *
 * 与 pattern 版差异：
 *   - 去掉：缩放下拉、画布/操作切换、预览下拉+Pixso、设备下拉、被注释的 titlebar-row-first
 *   - 保留：刷新、预览（单按钮，另开窗口）、复位（SCENE_RESET_CAMERA）、
 *            编辑、历史下拉、下载
 *   - 隐藏：主题切换（预留）、分享
 *   - 新增：复位协议（3D 专属，pattern 的复位是 CanvasView 居中）
 */
import { createSignal, onCleanup, For, Show } from "solid-js"
import {
  IconActionDownload,
  IconActionShare,
  IconRefresh,
  IconCenterReset,
  IconEditPencil,
  IconHistoryClock,
  IconSun,
  IconMoon,
  IconActionPreview,
} from "../icons"
import type { VersionEntry } from "../../utils/version-history"
import "../../assets/style/preview/titleBar.css"

interface TitleBar3DProps {
  onRefresh: () => void
  onPreview: () => void
  onReset: () => void
  onToggleEditing: () => void
  onShare?: () => void
  onDownload?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
  onThemeChange: (mode: "light" | "dark") => void
  editing?: boolean
}

export function TitleBar3D(props: TitleBar3DProps) {
  // === 主题（预留） ===
  const [isDarkMode, setIsDarkMode] = createSignal(true) // 3D 默认深色

  // === 历史下拉 ===
  const [showHistory, setShowHistory] = createSignal(false)

  // 点击外部自动收起
  const closeAllDropdowns = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest(".dropdown-trigger-container")) {
      setShowHistory(false)
    }
  }
  window.addEventListener("click", closeAllDropdowns)
  onCleanup(() => window.removeEventListener("click", closeAllDropdowns))

  function toggleThemeMode() {
    const nextMode = !isDarkMode()
    setIsDarkMode(nextMode)
    props.onThemeChange(nextMode ? "dark" : "light")
  }

  return (
    <div class="titlebar-wrapper">
      <div class="titlebar-row-second">
        {/* 左组：刷新 | 预览 */}
        <div class="toolbar-flex-left">
          <button class="preview-action-icon-btn" title="刷新页面" onClick={() => props.onRefresh()}>
            <IconRefresh size={14} />
          </button>

          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 2px 0 6px" }} />

          <button class="preview-action-icon-btn" title="实时预览" onClick={() => props.onPreview()}>
            <IconActionPreview size={14} />
          </button>
        </div>

        {/* 右组：复位 | 编辑 | 历史 | 主题(隐藏) | 分隔 | 分享(隐藏) | 下载 */}
        <div class="toolbar-flex-right">
          <button class="pattern-action-btn" title="复位视角" onClick={() => props.onReset()}>
            <IconCenterReset size={16} />
            <span>复位</span>
          </button>

          <button
            class="pattern-action-btn"
            classList={{ "edit-active": !!props.editing }}
            title="编辑"
            onClick={() => props.onToggleEditing()}
          >
            <IconEditPencil size={16} />
            <span>编辑</span>
          </button>

          {/* 历史下拉 */}
          <div class="dropdown-trigger-container">
            <button
              class="pattern-action-btn"
              title="历史版本"
              onClick={() => setShowHistory(!showHistory())}
            >
              <IconHistoryClock size={16} />
              <span>历史</span>
            </button>
            <Show when={showHistory()}>
              <div class="history-dropdown-panel">
                <Show
                  when={(props.versions?.length ?? 0) > 0}
                  fallback={<div class="history-empty">暂无历史版本</div>}
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
                        <span
                          class="history-dot"
                          data-active={v.id === props.currentVersionId ? "" : undefined}
                        >
                          {v.id === props.currentVersionId ? "●" : "○"}
                        </span>
                        <span class="history-time">
                          {new Date(v.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span class="history-summary" title={v.summary}>
                          {v.summary}
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          {/* 主题切换（预留，暂隐藏） */}
          {/* <button
            class="pattern-action-btn"
            title={isDarkMode() ? "切换为浅色模式" : "切换为深色模式"}
            onClick={toggleThemeMode}
          >
            {isDarkMode() ? <IconSun size={16} /> : <IconMoon size={16} />}
            <span>{isDarkMode() ? "浅色" : "深色"}</span>
          </button> */}

          <div class="btn-vertical-divider" style={{ height: "10px", margin: "0 8px" }} />

          {/* 分享（暂隐藏） */}
          {/* <button class="pattern-action-btn" title="分享" onClick={() => props.onShare?.()}>
            <IconActionShare size={16} />
            <span>分享</span>
          </button> */}

          <button class="pattern-action-btn" title="下载" onClick={() => props.onDownload?.()}>
            <IconActionDownload size={16} />
            <span>下载</span>
          </button>
        </div>
      </div>
    </div>
  )
}
