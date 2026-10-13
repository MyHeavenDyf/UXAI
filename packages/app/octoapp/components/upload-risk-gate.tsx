import { createSignal, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocal } from "@/context/local"
import { tracker } from "@/utils/tracker"
import { MakeModelRiskDialog, MakeModelRiskLink, AI_MANAGEMENT_GUIDE_URL } from "@/pages/make/make-model-risk-dialog"

// 外网模型上传/添加附件风险提示文案(insight / make 各上传入口共用)。
export const UPLOAD_RISK_COPY =
  "根据公司信息安全要求，仅可上传样式代码，不能上传核心交付代码，请核查后再进行上传。"

// 外网模型选择产品资产/设计文件时的风险提示文案
export function AssetRiskContent(): JSX.Element {
  return (
    <>
      请严格遵守公司信息安全规定，仅支持密级为"外部公开"的附件上传，保密信息请勿作为附件发送给外部AI大模型（内部公开、秘密、机密、绝密）。公司政策详见
      <MakeModelRiskLink href={AI_MANAGEMENT_GUIDE_URL}>《业务生产与办公生成式人工智能管理指引》</MakeModelRiskLink>
    </>
  )
}

/**
 * 外网模型上传风险确认门禁:
 * - `request(action, asset?)`:当前模型为外网(isExternal)时先弹风险提示弹框,确认后才执行 action;内网模型直接执行。
 *   `asset` 为 true 时使用产品资产/设计文件专用文案(AssetRiskContent)。
 * - `gate`:需渲染到组件 JSX 里的风险弹框节点(放组件末尾即可)。
 *
 * 用法:
 *   const { request, gate } = useUploadRiskGate()
 *   onUpload={() => request(() => fileInputRef.click())}
 *   // ...JSX 末尾放 {gate}
 */
export function useUploadRiskGate(opts?: { module?: string }) {
  const local = useLocal()
  const [riskOpen, setRiskOpen] = createSignal(false)
  const [assetMode, setAssetMode] = createSignal(false)
  let pendingAction: (() => void) | null = null

  const request = (action: () => void, asset = false) => {
    if (local.model.current()?.isExternal) {
      pendingAction = action
      setAssetMode(asset)
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
            content={assetMode() ? <AssetRiskContent /> : UPLOAD_RISK_COPY}
            onCancel={() => {
              pendingAction = null
              setRiskOpen(false)
            }}
            onConfirm={() => {
              if (opts?.module) {
                tracker.interaction({ module: opts.module, name: "external-model-risk-confirm" })
              }
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
