import { Splash } from "@opencode-ai/ui/logo"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { ProjectInfoDialogContent } from "./project-info-dialog-content"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { isValidUserPath } from "@/utils/path-valid"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import { addUserProject } from "@/network/pipelineRequest"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

interface DialogProjectOnboardingProps {
  onSelect: (data: { directory: string; domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void
}

// 读取当前登录用户身份用于数据看板统计上报:
//   userName ← localStorage.userInfo.nickName(昵称)
//   userId   ← localStorage.userInfo.account(工号, 后端 userId 字段实际取工号)
// 任一缺失返回空对象 → 调用方跳过上报(后端两字段均必传, 缺则不发必失败的请求)。
function readUserIdentity(): { userName?: string; userId?: string } {
  try {
    const info = JSON.parse(localStorage.getItem("userInfo") ?? "{}") as { nickName?: string; account?: string }
    return { userName: info.nickName?.trim(), userId: info.account?.trim() }
  } catch {
    return {}
  }
}

export function DialogProjectOnboarding(props: DialogProjectOnboardingProps) {
  const globalSync = useGlobalSync()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()

  const initialDirectory = createMemo(() => {
    if (!server.ready()) return ""
    
    const last = server.projects.last()
    if (isValidUserPath(last)) return last
    
    const recent = globalSync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    const recentPath = recent[0]?.worktree
    if (isValidUserPath(recentPath)) return recentPath
    
    return ""
  })

  const lastSelection = server.projects.lastSelection()

  const [selections, setSelections] = createStore({
    domain: lastSelection?.domain,
    productLine: lastSelection?.productLine,
    product: lastSelection?.product,
    version: lastSelection?.version,
  })

  const [directory, setDirectory] = createSignal<string>("")
  const [triedSubmit, setTriedSubmit] = createSignal(false)

  createEffect(() => {
    const init = initialDirectory()
    if (init && !directory()) {
      setDirectory(init)
    }
  })

  function handleConfirm() {
    const dir = directory()
    if (!dir) {
      setTriedSubmit(true)
      return
    }
    const product = selections.product
    const domain = product ? selections.domain : undefined
    const productLine = product ? selections.productLine : undefined
    const version = product ? selections.version : undefined
    tracker.interaction({
      module: "project-onboarding",
      name: "confirm",
      subType: "click",
      extend: JSON.stringify({
        domain,
        productLine,
        product,
        productVersion: version,
        dir
      }),
    })
    // 数据看板统计: 上报用户项目选择(domain/productLine/product/version 取各对象 name; fire-and-forget, 失败 silent 不阻断)
    const identity = readUserIdentity()
    if (identity.userName && identity.userId) {
      void addUserProject({
        userName: identity.userName,
        userId: identity.userId,
        domain: domain?.name,
        productLine: productLine?.name,
        product: product?.name,
        version: version?.name,
      })
    }
    layout.projects.open(dir)
    server.projects.touch(dir)
    void globalSDK.createClient({ directory: dir }).session.list().catch(() => {})
    server.projects.saveSelection({
      domain,
      productLine,
      product,
      version,
    })
    props.onSelect({
      directory: dir,
      domain,
      productLine,
      product,
      version,
    })
  }

  const hasDirectory = createMemo(() => directory().length > 0)
  const showDirError = createMemo(() => triedSubmit() && !hasDirectory())

  return (
    <Portal>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
      >
      <div
        class="flex flex-col items-center"
        style={{
          width: "400px",
          background: "linear-gradient(166deg, rgb(255, 255, 255) 0%, rgb(253, 254, 255) 48%, rgb(233, 245, 255) 99%)",
          "border-radius": "8px",
          padding: "40px 32px 32px 32px",
          "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
          overflow: "visible",
        }}
      >
        <Splash class="w-[80px] h-[80px]" />
        <img src="/octo-agent.png" alt="Octo Agent" style={{ width: "212px", height: "42px", "margin-top": "20px" }} />
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "24px", "letter-spacing": "2px", "text-align": "center", color: "rgba(110, 115, 122, 1)", "margin-top": "4px" }}>您的全能设计与调研专家</div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "40px", width: "100%" }}>选择项目&版本</div>
        <div style={{ width: "100%", height: "40px", "margin-top": "4px" }}>
          <ProjectInfoDialogContent
            domain={selections.domain}
            productLine={selections.productLine}
            product={selections.product}
            version={selections.version}
            onSelectionChange={(data) => {
              setSelections("domain", data.domain)
              setSelections("productLine", data.productLine)
              setSelections("product", data.product)
              setSelections("version", data.version)
            }}
          />
        </div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "16px", width: "100%", color: "#191919" }}>
          <span style={{ color: "var(--octo-danger, #ef4444)", "font-size": "12px", "margin-right": "2px" }} aria-hidden="true">*</span>
          <span>关联本地文件夹</span>
        </div>

        <div style={{ width: "100%", "margin-top": "4px" }}>
          <WorkspaceSwitcher
            value={directory()}
            error={showDirError()}
            onChange={(dir) => {
              setDirectory(dir)
              setTriedSubmit(false)
            }}
          />
        </div>

        <div style={{ width: "100%", height: "20px", display: "flex", "align-items": "center", gap: "4px", "margin-top": "4px", "margin-bottom": "8px" }}>
          <Show when={showDirError()}>
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" style={{ "flex-shrink": "0" }}>
              <circle cx="10" cy="10" r="8.5" stroke="var(--octo-danger, #ef4444)" stroke-width="1.5" />
              <path d="M7.5 7.5L12.5 12.5M12.5 7.5L7.5 12.5" stroke="var(--octo-danger, #ef4444)" stroke-width="1.5" stroke-linecap="square" />
            </svg>
            <span id="dir-error" role="alert" style={{ "font-size": "12px", color: "var(--octo-danger, #ef4444)" }}>未选择关联本地文件夹</span>
          </Show>
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          class="w-full h-[48px] rounded-[12px] text-[14px] font-medium text-white"
          style={{
            background: hasDirectory() ? "#0a59f7" : "rgba(10, 89, 247, 0.5)",
            color: "#fff",
            cursor: hasDirectory() ? "pointer" : "default",
          }}
        >
          确定
        </button>
      </div>
    </div>
    </Portal>
  )
}