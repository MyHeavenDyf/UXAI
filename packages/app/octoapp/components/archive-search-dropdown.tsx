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
        classList={{ "archive-search-trigger-active": open() }}
        onClick={() => setOpen(!open())}
      >
        <span class="archive-search-trigger-text">{displayText()}</span>
        <span class="archive-search-trigger-icon" style={{ transform: open() ? "rotate(180deg)" : "none" }}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="currentColor" fill-opacity="0.6"/>
          </svg>
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
          height: 32px;
          padding: 0 12px;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 8px;
          background: var(--octo-surface-page, #ffffff);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          line-height: 22px;
          color: rgba(0, 0, 0, 0.9);
          box-sizing: border-box;
        }
        .archive-search-trigger:hover {
          border-color: #0a59f7;
        }
        .archive-search-trigger-active {
          border-color: #0a59f7;
        }
        .archive-search-trigger-text {
          flex: 1;
          text-align: left;
          color: rgba(0, 0, 0, 0.9);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .archive-search-trigger-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          flex-shrink: 0;
          transition: transform 0.15s;
        }
        .archive-search-popup {
          background: var(--surface-raised-stronger-non-alpha, #ececec);
          border: none;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
          padding: 8px;
          overflow: hidden;
        }
        .archive-search-input-wrap {
          padding: 0 0 4px 0;
          margin-bottom: 4px;
        }
        .archive-search-input-wrap input {
          width: 100%;
          padding: 4px 8px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          line-height: 18px;
          outline: none;
          background: var(--octo-surface-selected, #ffffff);
          color: var(--octo-text-primary, rgba(0, 0, 0, 0.9));
          box-sizing: border-box;
        }
        .archive-search-input-wrap input:focus {
          background: var(--octo-surface-selected, #ffffff);
        }
        .archive-search-list {
          overflow-y: auto;
        }
        .archive-search-item {
          display: flex;
          align-items: center;
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          font-size: 14px;
          line-height: 22px;
          color: #191919;
          cursor: pointer;
          margin-bottom: 1px;
          transition: background 0.1s;
          box-sizing: border-box;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .archive-search-item:last-child {
          margin-bottom: 0;
        }
        .archive-search-item:hover {
          background: rgba(0, 0, 0, 0.1);
        }
        .archive-search-item-selected {
          background: rgba(0, 0, 0, 0.05);
        }
        .archive-search-item-selected:hover {
          background: rgba(0, 0, 0, 0.1);
        }
        .archive-search-item:active {
          background: rgba(0, 0, 0, 0.15);
        }
        .archive-search-empty {
          padding: 16px 12px;
          text-align: center;
          color: var(--octo-text-secondary);
          font-size: 13px;
        }
      `}</style>
    </div>
  )
}