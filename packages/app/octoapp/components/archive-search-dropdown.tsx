import { createSignal, For, Show, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"

interface DropdownItem {
  id: string | number
  label: string
}

interface Props {
  items: DropdownItem[]
  selectedId: string | number | null
  selectedLabel?: string
  onSelect: (id: string | number, item: DropdownItem) => void
  searchPlaceholder?: string
  triggerPlaceholder?: string
  maxHeight?: string
}

export function ArchiveSearchDropdown(props: Props): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [searchText, setSearchText] = createSignal("")
  let triggerRef: HTMLButtonElement | undefined

  const filteredItems = () => {
    const search = searchText().toLowerCase().trim()
    if (!search) return props.items
    return props.items.filter(item => item.label.toLowerCase().includes(search))
  }

  const handleSelect = (item: DropdownItem) => {
    props.onSelect(item.id, item)
    setOpen(false)
    setSearchText("")
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (!open()) return
    const target = e.target as HTMLElement
    if (triggerRef && !triggerRef.contains(target)) {
      const popup = document.querySelector(".archive-search-popup")
      if (popup && !popup.contains(target)) {
        setOpen(false)
        setSearchText("")
      }
    }
  }

  createEffect(() => {
    if (open()) {
      document.addEventListener("click", handleClickOutside)
    } else {
      document.removeEventListener("click", handleClickOutside)
    }
    onCleanup(() => {
      document.removeEventListener("click", handleClickOutside)
    })
  })

  const displayText = () => props.selectedLabel || props.triggerPlaceholder || "请选择"

  const popupStyle = () => {
    if (!triggerRef) return {}
    const rect = triggerRef.getBoundingClientRect()
    return {
      position: "fixed" as const,
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 300)}px`,
      "z-index": 10001
    }
  }

  return (
    <div class="archive-search-dropdown-wrapper">
      <button
        ref={triggerRef}
        type="button"
        class="archive-search-trigger"
        onClick={() => setOpen(!open())}
      >
        <span class="archive-search-trigger-text">{displayText()}</span>
        <span class="archive-search-trigger-icon" style={{ transform: open() ? "rotate(180deg)" : "none" }}>
          ▼
        </span>
      </button>

      <Show when={open()}>
        <Portal mount={document.body}>
          <div class="archive-search-popup" style={popupStyle()}>
            <div class="archive-search-input-wrap">
              <input
                type="text"
                placeholder={props.searchPlaceholder || "搜索..."}
                value={searchText()}
                onInput={(e) => setSearchText(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div
              class="archive-search-list"
              style={{ "max-height": props.maxHeight || "250px" }}
            >
              <Show when={filteredItems().length === 0}>
                <div class="archive-search-empty">无匹配结果</div>
              </Show>
              <For each={filteredItems()}>
                {item => (
                  <div
                    class="archive-search-item"
                    classList={{ "archive-search-item-selected": props.selectedId === item.id }}
                    onClick={() => handleSelect(item)}
                  >
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>

      <style>{`
        .archive-search-dropdown-wrapper {
          position: relative;
        }
        .archive-search-trigger {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--octo-border-default);
          border-radius: 6px;
          background: var(--octo-surface-default);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }
        .archive-search-trigger:hover {
          border-color: var(--octo-border-focus);
        }
        .archive-search-trigger-text {
          flex: 1;
          text-align: left;
          color: var(--octo-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .archive-search-trigger-icon {
          font-size: 10px;
          color: var(--octo-text-secondary);
          transition: transform 0.15s;
        }
        .archive-search-popup {
          background: #ffffff;
          border: 1px solid var(--octo-border-default);
          border-radius: 8px;
          box-shadow: var(--octo-shadow-lg);
          overflow: hidden;
        }
        .archive-search-input-wrap {
          padding: 8px;
          border-bottom: 1px solid var(--octo-border-subtle);
        }
        .archive-search-input-wrap input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--octo-border-default);
          border-radius: 4px;
          font-size: 13px;
          outline: none;
        }
        .archive-search-input-wrap input:focus {
          border-color: var(--octo-border-focus);
        }
        .archive-search-list {
          overflow-y: auto;
        }
        .archive-search-item {
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          color: var(--octo-text-primary);
          border-bottom: 1px solid var(--octo-border-subtle);
        }
        .archive-search-item:last-child {
          border-bottom: none;
        }
        .archive-search-item:hover {
          background: var(--octo-surface-hover);
        }
        .archive-search-item-selected {
          background: rgba(37, 99, 235, 0.1);
        }
        .archive-search-item-selected:hover {
          background: rgba(37, 99, 235, 0.15);
        }
        .archive-search-empty {
          padding: 16px;
          text-align: center;
          color: var(--octo-text-secondary);
          font-size: 13px;
        }
      `}</style>
    </div>
  )
}