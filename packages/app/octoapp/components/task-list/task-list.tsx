import { createSignal, createMemo, Show, For } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { TaskStore } from "@/context/task"
import { TaskItemRow } from "./task-item"

export function TaskList() {
  const [shown, setShown] = createSignal(false)
  const activeItems = TaskStore.activeItems
  const errorItems = TaskStore.errorItems
  const pausedItems = TaskStore.pausedItems
  const completedItems = TaskStore.completedItems
  const cancelledItems = TaskStore.cancelledItems
  const activeCount = TaskStore.activeCount

  // 拼接全部分组，决定任务中心的展示顺序：进行中→已暂停→失败→已完成→已取消
  const allItems = createMemo(() => {
    const active = activeItems()
    const paused = pausedItems()
    const errors = errorItems()
    const completed = completedItems()
    const cancelled = cancelledItems()
    return [...active, ...paused, ...errors, ...completed, ...cancelled]
  })

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
        // 标题栏入口：有进行中任务时图标变蓝并显示数量徽标
        <div class="relative flex items-center justify-center">
          <span style={{ display: "inline-block", width: "16px", height: "16px", "background-image": `url(${activeCount() > 0 ? "/task/task-center-active.svg" : "/task/task-center.svg"})`, "background-size": "contain", "background-repeat": "no-repeat", "background-position": "center" }} />
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
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] rounded-xl"
      gutter={4}
      placement="bottom-end"
    >
      {/* 下拉面板：固定 360×446，头部 + 可滚动列表 */}
      <div class="flex flex-col" style={{
        background: "#fff",
        "border-radius": "12px",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
        height: "446px",
      }}>
        {/* 头部：标题 + 关闭按钮 */}
        <div class="flex items-center justify-between shrink-0" style={{ padding: "16px 16px 4px 16px" }}>
          <span class="text-[14px] font-semibold" style={{ color: "#191919", "line-height": "22px", padding: "8px" }}>
            任务中心
          </span>
          <button
            type="button"
            class="rounded-[6px] transition-colors hover:bg-black/[0.06]"
            style={{ width: "16px", height: "16px", cursor: "pointer", "background-image": "url(/task/task-panel-close.svg)", "background-size": "contain", "background-repeat": "no-repeat", "background-position": "center" }}
            onClick={() => setShown(false)}
          />
        </div>
        <Show
          when={allItems().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center px-4 pb-4 text-[12px] text-center" style={{ color: "rgba(0,0,0,0.4)" }}>
              暂无任务
            </div>
          }
        >
        {/* 列表区：撑满剩余高度并滚动；space-y-1 提供项间距，scrollbar-gutter 保证有/无滚动条时间距一致 */}
          <div class="flex-1 pb-4 overflow-y-auto space-y-1" style={{ "padding-left": "calc(var(--spacing) * 4)",  "scrollbar-gutter": "stable" }}>
            <For each={allItems()}>
              {(item) => <TaskItemRow item={item} />}
            </For>
          </div>
        </Show>
      </div>
    </Popover>
  )
}
