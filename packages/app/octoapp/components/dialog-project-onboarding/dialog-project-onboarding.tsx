import { Splash } from "@opencode-ai/ui/logo"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { ProjectInfoDialogContent } from "./project-info-dialog-content"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { DialogRepoAssociate } from "./dialog-repo-associate"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { isValidUserPath } from "@/utils/path-valid"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { tracker } from "@/utils/tracker"
import { addUserProject } from "@/network/pipelineRequest"
import { getUser } from "@/context/auth"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

interface DialogProjectOnboardingProps {
  onSelect: (data: { directory: string; domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void
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
  // 关联代码仓弹窗开关 & 已关联的远程仓库地址(暂存,随项目确认时一并上报)
  const [repoDialogOpen, setRepoDialogOpen] = createSignal(false)
  const [repoUrl, setRepoUrl] = createSignal("")

  createEffect(() => {
    const init = initialDirectory()
    if (init && !directory()) {
      setDirectory(init)
    }
  })

  // 切换目录时清除已关联的代码仓地址,避免上报脏数据
  createEffect(() => {
    const dir = directory()
    if (dir) setRepoUrl("")
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
        dir,
        repoUrl: repoUrl() || undefined,
      }),
    })
    // 数据看板统计: 上报用户项目选择(复用 auth.getUser() 取登录身份; userName←nickName, userId←account; domain/productLine/product/version 取各对象 name; designOwner←version.ownerList、designDl←version.uxDlList, 多人取 nickName 以逗号拼接, 元素 nickName 可能为 null 用 ?? 兜底防止同步 throw 中断主流程; fire-and-forget, 失败 silent 不阻断)
    // 登录态缺失或 nickName/account 为空时跳过上报(打点不受影响), console.warn 留痕便于排查"有打点无统计"问题
    const user = getUser()
    const userName = user?.nickName?.trim()
    const userId = user?.account?.trim()
    if (userName && userId) {
      void addUserProject({
        userName,
        userId,
        domain: domain?.name,
        productLine: productLine?.name,
        product: product?.name,
        version: version?.name,
        designOwner: version?.ownerList?.map((m) => (m.nickName ?? "").trim()).filter(Boolean).join(",") || undefined,
        designDl: version?.uxDlList?.map((m) => (m.nickName ?? "").trim()).filter(Boolean).join(",") || undefined,
      })
    } else {
      console.warn("[onboarding] 数据看板上报跳过: 登录态缺失或 nickName/account 为空", {
        hasUser: !!user,
        hasNickName: !!userName,
        hasAccount: !!userId,
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
        {/* 关联本地文件夹标签行:左侧必填标题,右侧"关联代码仓"入口按钮 */}
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "16px", width: "100%", color: "var(--octo-text-base, #191919)", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <div style={{ display: "flex", "align-items": "center" }}>
            <span style={{ color: "var(--octo-danger, #ef4444)", "font-size": "12px", "margin-right": "2px" }} aria-hidden="true">*</span>
            <span>关联本地文件夹</span>
          </div>
          {/* 点击后弹出关联代码仓弹窗,检测/关联当前所选目录的远程仓库 */}
          <button
            type="button"
            onClick={() => setRepoDialogOpen(true)}
            style={{
              "font-size": "14px",
              "line-height": "20px",
              "font-weight": 400,
              color: "var(--octo-brand, #0a59f7)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0",
            }}
          >
            关联代码仓
          </button>
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
        {/* 关联代码仓弹窗:传入当前所选目录,确认后暂存 repoUrl 并关闭 */}
        <Show when={repoDialogOpen()}>
          <DialogRepoAssociate
            directory={directory()}
            onClose={() => setRepoDialogOpen(false)}
            onConfirm={(url) => {
              setRepoUrl(url)
              setRepoDialogOpen(false)
            }}
          />
        </Show>
      </div>
    </div>
    </Portal>
  )
}