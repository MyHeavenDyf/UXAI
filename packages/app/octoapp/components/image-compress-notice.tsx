// 超限图片自动压缩的输入框上方提示条(design/insight/studio 三页共用,样式与交互单一事实源):
// #eef3fe 胶囊、40px 高、make_risk_info.svg 14px 图标、#191919 文案、右侧 × 关闭
// (本次批次内隐藏,下一批 0→1 自动恢复)、下方 24px 间距(pb-6)。
// 状态为模块级(同 octo-toast 模式):各页调 compressImageWithNotice 驱动计数,提示条放 composer 上方;
// studio 需与输入框边框水平对齐时,外面包一层 .studio-composer-wrap(复用其响应式水平 padding)。
import { createSignal, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { showFloatingNotice } from "@/components/floating-notice"
import { compressImageFile } from "@/utils/image-compression"

const [compressingCount, setCompressingCount] = createSignal(0)
const [noticeDismissed, setNoticeDismissed] = createSignal(false)
const [noticeLimitBytes, setNoticeLimitBytes] = createSignal(1024 * 1024)

/** 压缩并驱动提示条(计数/关闭态/上限文案全自动);成功后的「已自动压缩」浮层提示也统一在此发出。
 *  压不动返回 null 由调用方回退原报错。 */
export async function compressImageWithNotice(file: File, maxSizeBytes: number, opts?: { webp?: boolean }): Promise<File | null> {
  if (compressingCount() === 0) {
    setNoticeDismissed(false)
    setNoticeLimitBytes(maxSizeBytes)
  }
  setCompressingCount((n) => n + 1)
  const compressed = await compressImageFile(file, maxSizeBytes, opts)
  setCompressingCount((n) => Math.max(0, n - 1))
  if (compressed) {
    showFloatingNotice("success", `图片已自动压缩：${(file.size / 1024 / 1024).toFixed(1)}MB → ${(compressed.size / 1024 / 1024).toFixed(1)}MB`)
  }
  return compressed
}

/** 「正在压缩上传」提示条:压缩进行中显示,放在输入框(composer)正上方。 */
export function ImageCompressNotice() {
  return (
    <Show when={compressingCount() > 0 && !noticeDismissed()}>
      <div class="flex items-center gap-2 pt-3 pb-6">
        <div class="flex items-center gap-2 px-3 h-10 rounded-[8px]" style={{ background: "#eef3fe" }}>
          <img src="/make_risk_info.svg" class="size-[14px] shrink-0" alt="" />
          <span class="text-[13px]" style={{ color: "#191919" }}>图片超出{Math.round(noticeLimitBytes() / 1024 / 1024)}MB，正在为你压缩上传</span>
          <button type="button" onClick={() => setNoticeDismissed(true)} aria-label="关闭提示">
            <Icon name="close" class="size-3 text-[#191919] hover:text-black" />
          </button>
        </div>
      </div>
    </Show>
  )
}
