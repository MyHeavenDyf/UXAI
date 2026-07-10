// 文件夹路径面包屑:对齐 Design(make/components/design-files/breadcrumb.tsx)。
// 颜色走 --octo-* 变量;根标签固定"全部文件"(insight 无 designFiles.title i18n 键)。

import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconChevronDown } from "../../icons/design-files-icons"

interface BreadcrumbProps {
  currentPath: string
  onNavigate: (path: string) => void
}

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const segments = () => props.currentPath.split("/").filter(Boolean)

  return (
    <div
      class="flex items-center gap-1 pr-6 shrink-0"
      style={{ "font-size": "14px", "line-height": "22px", color: "var(--octo-text-primary)", "margin-bottom": "16px", background: "var(--octo-surface-page)" }}
    >
      <button
        type="button"
        onClick={() => props.onNavigate("")}
        class="hover:text-[var(--octo-brand)] transition-colors cursor-pointer font-medium"
        style={{ color: "var(--octo-text-primary)" }}
      >
        文件管理
      </button>

      <For each={segments()}>
        {(segment, index) => {
          const isLast = () => index() === segments().length - 1
          const pathUpTo = () => segments().slice(0, index() + 1).join("/")

          return (
            <>
              {/* chevron 分隔符:用 design-files-icons 的 IconChevronDown 旋转 -90° 当右箭头,
                  与 Design 面包屑同源(Design 用 ui Icon chevron-right,此处复用已有图标集) */}
              <IconChevronDown size={16} style={{ transform: "rotate(-90deg)", color: "var(--octo-text-secondary)" }} />
              <Show when={!isLast()} fallback={<span class="font-medium">{segment}</span>}>
                <button
                  type="button"
                  onClick={() => props.onNavigate(pathUpTo())}
                  class="transition-colors cursor-pointer hover:text-[var(--octo-brand)]"
                  style={{ color: "var(--octo-text-secondary)" }}
                >
                  {segment}
                </button>
              </Show>
            </>
          )
        }}
      </For>
    </div>
  )
}
