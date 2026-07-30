import { createSignal, createMemo, Show, For } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { TaskStore } from "@/context/task"
import { TaskItemRow } from "./task-item"
import "./task-center.css"

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
    <Show when={allItems().length > 0}>
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs="button"
      triggerProps={{
        type: "button",
        class: "flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.06] active:bg-black/[0.10]",
        style: { width: "32px", height: "32px", cursor: "pointer" },
      }}
      trigger={
        // 标题栏入口：有进行中任务时图标外加旋转圈(28)并缩小为 16；全为终态时显示 28 图标；无数据时整入口隐藏(见外层 Show)
        <div class="relative flex items-center justify-center" style={{ width: "28px", height: "28px" }}>
          <Show when={activeCount() > 0}>
            <span class="task-center-spin" style={{ position: "absolute", inset: 0, "border-radius": "50%", border: "2px solid rgba(0,0,0,0.1)", "border-top-color": "#0A59F7", "box-sizing": "border-box" }} />
          </Show>
          <span style={{ display: "inline-block", width: activeCount() > 0 ? "16px" : "28px", height: activeCount() > 0 ? "16px" : "28px", "background-image": "url(/task/task-center.svg)", "background-size": "contain", "background-repeat": "no-repeat", "background-position": "center" }} />
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
        cursor: "default",
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
        {/* 列表区：撑满剩余高度并滚动；space-y-1 提供项间距，scrollbar-gutter 保证有/无滚动条时间距一致 */}
        <div class="task-center-scroll flex-1 pb-4 overflow-y-auto space-y-1" style={{ "padding-left": "calc(var(--spacing) * 4)", "padding-right": "calc(var(--spacing) * 2.5)", "scrollbar-gutter": "stable" }}>
          <For each={allItems()}>
            {(item) => <TaskItemRow item={item} onPause={TaskStore.togglePause} onCancel={TaskStore.cancel} />}
          </For>
        </div>
      </div>
    </Popover>
    </Show>
  )
}
