/**
 * SceneCreateInput —— LLM 子会话调用的公共输入（原 create-scene.ts 导出；Step 7 后
 * 旧 8-agent JSON 流水线（create-scene.ts / modify-scene-ai.ts）整体废弃删除，
 * 类型挪此独立文件供 codegen-scene / scene-plan / scene-codegen / index.tsx 共用）。
 */
export type SceneCreateInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户输入
  userInput: string
  // 额外补充信息，透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
  // 文件附件（图片等，传给 agent 的 prompt parts）
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
}
