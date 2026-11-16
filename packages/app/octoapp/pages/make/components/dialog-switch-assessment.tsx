import type { JSX } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import hintSvg from "../icons/hint.svg"

/** 切换领域评估确认弹窗 */
export function DialogSwitchAssessment(props: { from: string; to: string; onCancel: () => void; onContinue: () => void }): JSX.Element {
  const dialog = useDialog()

  return (
    <Dialog
      fit
      class="switch-assessment-dialog"
      title={
        <span class="switch-assessment-title">
          <img src={hintSvg} alt="" draggable={false} />
          切换领域评估提示
        </span>
      }
    >
      <div class="flex flex-col gap-4">
        <span class="text-14-regular text-text-strong">
          您将从【{props.from}】切换为【{props.to}】，是否继续？
        </span>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="switch-assessment-btn"
            onClick={() => {
              dialog.close()
              props.onCancel()
            }}
          >
            取消
          </button>
          <button
            type="button"
            class="switch-assessment-btn switch-assessment-btn-primary"
            onClick={() => {
              dialog.close()
              props.onContinue()
            }}
          >
            继续
          </button>
        </div>
      </div>
    </Dialog>
  )
}
