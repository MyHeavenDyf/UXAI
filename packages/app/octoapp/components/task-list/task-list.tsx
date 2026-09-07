import { createSignal, Show, For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { TaskStore } from "@/context/task"
import { TaskItemRow } from "./task-item"

export function TaskList() {
  const [shown, setShown] = createSignal(false)
  const activeItems = TaskStore.activeItems
  const errorItems = TaskStore.errorItems
  const completedItems = TaskStore.completedItems
  const activeCount = TaskStore.activeCount

  const allItems = () => {
    const active = activeItems()
    const errors = errorItems()
    const completed = completedItems()
    return [...active, ...errors, ...completed]
  }

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs="button"
      triggerProps={{
        type: "button",
        class: "flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06] active:bg-black/[0.10]",
        style: { width: "32px", height: "32px" },
      }}
      trigger={
        <div class="relative flex items-center justify-center">
          <Icon name={shown() ? "task" : "task"} size="small" style={{ color: activeCount() > 0 ? "#0A59F7" : "rgba(0,0,0,0.6)" }} />
          <Show when={activeCount() > 0}>
            <span
              class="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[10px] font-bold leading-none"
              style={{
                width: "14px",
                height: "14px",
                background: "#0A59F7",
                color: "#fff",
              }}
            >
              {activeCount() > 9 ? "9+" : activeCount()}
            </span>
          </Show>
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[320px] max-w-[calc(100vw-40px)] rounded-xl"
      gutter={4}
      placement="bottom-end"
    >
      <div style={{
        background: "#fff",
        "border-radius": "12px",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
      }}>
        <div class="flex items-center justify-between px-4 pt-3 pb-2">
          <span class="text-[14px] font-semibold" style={{ color: "rgba(0,0,0,0.9)" }}>
            任务列表
          </span>
          <Show when={completedItems().length > 0 || errorItems().length > 0}>
            <button
              type="button"
              class="text-[12px] transition-colors hover:text-[#0A59F7]"
              style={{ color: "rgba(0,0,0,0.4)" }}
              onClick={TaskStore.removeFinished}
            >
              清除已完成
            </button>
          </Show>
        </div>
        <Show
          when={allItems().length > 0}
          fallback={
            <div class="px-4 pb-4 text-[12px] text-center" style={{ color: "rgba(0,0,0,0.4)" }}>
              暂无任务
            </div>
          }
        >
          <div class="px-4 pb-2 overflow-y-auto" style={{ "max-height": "320px" }}>
            <For each={allItems()}>
              {(item) => <TaskItemRow item={item} />}
            </For>
          </div>
        </Show>
      </div>
    </Popover>
  )
}
