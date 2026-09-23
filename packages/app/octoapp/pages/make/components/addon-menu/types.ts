import type { JSX } from "solid-js"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import type { AssetFile as LibraryAssetFile } from "./asset-library"

/** 内置菜单项 key(items 配置用) */
export type AddonMenuItemKey =
  | "skills"
  | "productAssets"
  | "designFiles"
  | "urlImport"
  | "addAttachment"

/** 页面专属菜单项插槽:render 在主菜单(items 之后)内渲染,ctx.closeMenu 关闭整个面板 */
export interface AddonMenuSlot {
  key: string
  render: (ctx: { closeMenu: () => void }) => JSX.Element
}

/** chip 联动核心类型(结构与 mention-popover 的 MentionSelection 一致) */
export type MenuSelection =
  | { type: "skill"; name: string; label: string }
  | { type: "file"; filename: string; path: string; id?: string; isFolder?: boolean }
  | { type: "product-asset"; filename: string; path: string; s3BaseUrl: string; convertHtmlUrl: string; snapshot: string }

import type { PanelSkill, SkillConfigEntry } from "../skill-config-types"

/** 技能库配置(复用 skill-config-types 类型) */
export interface AddonSkillConfig {
  skill?: Record<string, SkillConfigEntry>
  panel?: {
    common?: PanelSkill[]
    octo_make?: PanelSkill[]
  }
}

/** 风险拦截(可选):request 包裹敏感操作,gate 为拦截弹窗 JSX */
export interface AddonRiskGate {
  request: (fn: () => void) => void
  gate: JSX.Element
}

export interface AddonMenuProps {
  /**
   * 菜单项编排:可混排内置 key(AddonMenuItemKey)与插槽 key(AddonMenuSlot.key),按数组顺序渲染。
   * 缺省为内置全序 + slots 追加在后。items 中无对应内置项/插槽定义的 key 会被跳过。
   */
  items?: string[]
  /** 页面专属菜单项插槽(渲染在内置项之后) */
  slots?: AddonMenuSlot[]
  disabled?: boolean

  /** doc 中已有 chip(由页面编辑器同步) */
  selections: MenuSelection[]
  onSelect: (selection: MenuSelection) => void
  onDeselect: (selection: MenuSelection) => void

  /** skills 项 */
  skillConfig?: AddonSkillConfig
  /** 打开面板时加载技能配置 */
  onSkillsOpen?: () => void

  /** productAssets 项 */
  productId?: number
  onDownloadProductAsset?: (
    file: LibraryAssetFile,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ) => Promise<string>
  onUpdateMentionPath?: (id: string, path: string) => void

  /** designFiles 项 */
  artifactFiles?: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null

  /** urlImport 项 */
  onAddAttachmentFromUrl?: (url: string, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<void>

  /** addAttachment 项 */
  onAddAttachment?: () => void
  /** 附件数已达上限(addAttachment 置灰) */
  maxAttachments?: boolean

  /** 埋点 module,默认 "design" */
  trackerModule?: string
}
