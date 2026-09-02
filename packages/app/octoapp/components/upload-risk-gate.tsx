import { createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocal } from "@/context/local"
import { MakeModelRiskDialog } from "@/pages/make/make-model-risk-dialog"

// 外网模型上传/添加附件风险提示文案(insight / make 各上传入口共用)。
export const UPLOAD_RISK_COPY =
  "根据公司信息安全要求，仅可上传样式代码，不能上传核心交付代码，请核查后再进行上传。"

/**
 * 外网模型上传风险确认门禁:
 * - `request(action)`:当前模型为外网(isExternal)时先弹风险提示弹框,确认后才执行 action;内网模型直接执行。
 * - `gate`:需渲染到组件 JSX 里的风险弹框节点(放组件末尾即可)。
 *
 * 用法:
 *   const { request, gate } = useUploadRiskGate()
 *   onUpload={() => request(() => fileInputRef.click())}
 *   // ...JSX 末尾放 {gate}
 */
export function useUploadRiskGate() {
  const local = useLocal()
  const [riskOpen, setRiskOpen] = createSignal(false)
  let pendingAction: (() => void) | null = null

  const request = (action: () => void) => {
    if (local.model.current()?.isExternal) {
      pendingAction = action
      setRiskOpen(true)
      return
    }
    action()
  }

  const gate = (
    <Show when={riskOpen()}>
      <Portal>
        {/* 外层 fixed + 高 z-index:抬升到菜单(addon-menu z-index 1000)之上;普通场景下仅作模态遮罩层,无副作用。 */}
        <div style={{ position: "fixed", inset: "0", "z-index": "10001" }}>
          <MakeModelRiskDialog
            content={UPLOAD_RISK_COPY}
            onCancel={() => {
              pendingAction = null
              setRiskOpen(false)
            }}
            onConfirm={() => {
              setRiskOpen(false)
              const action = pendingAction
              pendingAction = null
              action?.()
            }}
          />
        </div>
      </Portal>
    </Show>
  )

  return { request, gate }
}
