// MCP 显式入口(研究工具 chip)的三件套构建器 —— SPEC-INS-017(octo-agent docs/specs/infra/insight-mcp-explicit-entry.md)
//
// 确定性边界(2026-07-06 二次评审后定案,其余交给 Agent 对话):
//   ① 触发**范围**固定:chip 选中期间 tools gate 只放行所选业务工具——若模型发起 MCP 业务调用,
//      100% 只会是这一个(其他业务工具模型根本看不到;get_task_result / stop_task 通用,常驻可见)。
//      **要不要调用由模型按用户消息判断**(模板强倾向:选中通常即希望解析,材料齐且无其他明确意图就调),
//      判断错了在对话里可见、可纠,不是静默数据损坏——这类意图问题归模型。
//   ② URL 传递固定:模型只写文件名,octo-upload-inject 精确校验/替换成 URL 并注入 file_names/user_prompt,
//      写错文件名 → 响亮失败错误回灌(不静默、不模糊匹配)。
//   文件"怎么来"(没上传→询问用户)与多角色分桶(哪个是大纲→拿不准先确认)归模型,不由客户端钉死。
//
//   1. buildToolGate      turn 级动态 gate(spec §3 方案 A):随 promptAsync 的 tools 参数下发,
//                         opencode 按 user.tools[key] !== false 过滤本 turn 模型可见工具集
//                         (packages/opencode/src/session/llm.ts resolveTools,上游原生机制,零服务端改动)。
//                         非 chip turn:5 个业务工具全 false;chip turn:只放行选中那一个。
//                         task 一律 false(SPEC-INS-021 §1:内部编排原语,不经用户提示词触发)。
//   2. buildChipTemplate  chip 注入模板(spec §4):解析模式指令 + 迁入的 MCP 仪式段落(长任务规则 /
//                         get_task_result 仪式 / 结果回复格式 / 文件引用铁律)。文件以会话 [附件]
//                         区块为准(不在模板里复述清单,避免两处漂移)。
//                         作为 synthetic text part 注入(用户不可见、模型可见,与 [附件] 清单同机制)。
//   3. buildChipDeclaration 机器可读声明段(spec §2.1):独立 synthetic text part,声明目标工具 +
//                         是否需要大纲字段 + 用户原文;octo-upload-inject 据此对 chip turn 的调用做
//                         字段级校验(文件名必须精确命中清单,否则响亮失败)与确定性注入
//                         (download_file_names / outline_file_name / user_prompt)。
//                         格式契约与插件 parseChipDeclaration 同源(两处独立实现,改格式需同步)。
//
// chip 生命周期 = 纯常驻(对齐 GPT/Gemini 工具模式):选中后跨发送保持,只有手动 × 才取消,无任何自动副作用。
// 之所以安全:触发是模型判断而非强制——任务提交后用户问"好了吗",模型按仪式走 get_task_result,
// 不会重复提交(曾因"模板强制每轮必调"需要"兑现即自动清除"兜重复提交,判断权还给模型后该机器整个拆除)。

import type { PresetPrompt } from "./preset-prompts"

// MCP server 前缀:agent.ts octo_insight 绑定 mcp: ["uxr-tool"],工具注册键 = `uxr-tool_<tool>`
// (mcp/index.ts sanitize 保留连字符)。server 名是 fork 内置固定键(config/builtin-mcp.ts),
// 用户覆盖配置也沿用同键,故此处可作常量。
export const MCP_TOOL_PREFIX = "uxr-tool_"

export const mcpToolKey = (tool: string) => `${MCP_TOOL_PREFIX}${tool}`

// 退出模型常驻工具集的 5 个业务工具(spec §3 摘除清单;search_reports 未对接、无 chip 入口,
// 任何 turn 都不放行)。get_task_result / stop_task 不在列——查询/终止发生在后续非 chip turn,必须常驻。
export const MCP_BUSINESS_TOOLS = [
  "key_findings",
  "run_guide_analysis",
  "run_usability_analysis",
  "mindmap",
  "search_reports",
] as const

/** chip 声明段头(与 [附件] 清单的 UPLOAD_BLOCK_HEADER 同类;插件按它定位声明 part) */
export const MCP_DECLARATION_HEADER = "[MCP声明]"

/** chip 选择:所选功能(分桶归模型,客户端不再指定大纲文件) */
export type McpSelection = {
  preset: PresetPrompt
}

/**
 * 本 turn 的工具可见性 gate。selectedTool 缺省 = 非 chip turn(业务工具全隐藏)。
 * 每次发送都必须携带:promptAsync 的 tools 会被服务端转成 session.permission 持久化,
 * 逐 turn 覆盖即无残留;漏传时上一轮的 deny 仍兜底隐藏。
 */
export function buildToolGate(selectedTool?: string): Record<string, boolean> {
  const gate: Record<string, boolean> = {}
  for (const tool of MCP_BUSINESS_TOOLS) gate[mcpToolKey(tool)] = tool === selectedTool
  // task 恒关、不分 chip 与否(SPEC-INS-021 §1 追加):task 是内部编排原语,不是用户能力入口——
  // 用户 turn 里模型自发起子代理对用研场景零收益(token/时延/弱模型跑偏),子会话还会被点成
  // "侧栏没有记录的对话"。agent 权限层保持 allow(白名单管常驻底线,turn 级由此 gate 管);
  // 018 多文档分治那类**我们编排的 turn** 由构造方显式放行(届时给本函数加参数下发 task=true)。
  gate["task"] = false
  if (selectedTool) {
    // chip turn 顺手关掉即兴逃生口(2026-07-07 内网验证教训):该 turn 的职责是一次**直接**工具
    // 调用,shell / webfetch 在本 turn 没有正当用途,却是弱模型在 MCP 工具缺失(如内网连接故障)
    // 时的模拟通道——实测出现过委托 task 子代理、用 shell 裸调 MCP HTTP、进而编造 task_id。
    // (webfetch/websearch 非 chip turn 常驻可用,SPEC-INS-021 §1。)bash 现已在 agent 权限层放开
    // (供 interview-analysis skill,见 agent.ts octo_insight),故本行是 chip turn 关闭 bash 的**唯一守卫**
    // (不再是从前那道"已常驻 deny、再关无害"的冗余)——删它会让研究工具那轮重新暴露 shell 逃生口。
    gate["bash"] = false // shell 工具注册键(tool/shell/id.ts ToolID),显示名 Shell,含 pwsh/cmd 变体
    gate["webfetch"] = false
  }
  return gate
}

/** 声明段 JSON 形态(插件侧同构解析) */
export type ChipDeclaration = {
  tool: string // 带 server 前缀的完整工具键,与 tool.execute.before 的 input.tool 直接比对
  /** 该工具是否要求 outline_file_path 字段(多角色工具);插件据此校验必填,免于按工具名硬编码 */
  outline_required: boolean
  /** 用户当轮键入的提示词原文:mcp-contract 承诺「原样透传、不经改写」,由插件强制写入
   *  (模型转述/改写一律矫正);未键入时缺省,不覆盖 */
  user_prompt?: string
}

export function buildChipDeclaration(sel: McpSelection, typedText: string): string {
  const decl: ChipDeclaration = {
    tool: mcpToolKey(sel.preset.expectedTool),
    outline_required: !!sel.preset.outlineRole,
    ...(typedText.trim() ? { user_prompt: typedText.trim() } : {}),
  }
  return `${MCP_DECLARATION_HEADER}\n${JSON.stringify(decl)}`
}

/**
 * chip 注入模板(spec §4):解析模式指令——范围钉死(只能调所选工具),是否调用由模型按用户消息判断
 * (强倾向调用)。MCP 仪式段落从常驻提示词(octo_insight.md)整段迁入 —— 只在 chip turn 进入上下文;
 * 注入后随 session 历史常驻,后续"查询任务 X"的非 chip turn 仍能看到查询仪式与回复格式。
 */
export function buildChipTemplate(sel: McpSelection, typedText: string): string {
  const toolKey = mcpToolKey(sel.preset.expectedTool)
  const outlineRole = sel.preset.outlineRole

  const paramLines = [
    `- download_links(数组):填入所有访谈逐字稿的**文件名**——照抄 [附件] 区块里冒号前那串,一字不差(系统会在执行前把文件名精确替换成真实地址,写错即失败并要求重填)。`,
  ]
  if (outlineRole) {
    paramLines.push(
      `- outline_file_path(单个字符串):填那个${outlineRole}文件的**文件名**(同样照抄清单)。若无法从文件名判断哪个文件是${outlineRole},**先向用户确认、得到答复后再调用**,不要猜。`,
    )
  }
  paramLines.push(
    typedText.trim()
      ? `- user_prompt(字符串):原样填入用户本轮输入,一字不改: ${JSON.stringify(typedText.trim())}`
      : `- user_prompt: 用户本轮未输入文字,不填该参数`,
  )

  return [
    `[MCP解析模式]`,
    `用户在输入框的「研究工具」中选择了「${sel.preset.label}」(该选择持续有效,直到用户手动取消)。本会话如需内网 MCP 解析,**只能调用** \`${toolKey}\`,不存在其他解析工具(任务查询/终止工具照常可用)。`,
    ``,
    `何时调用(判断规则,按序核对):`,
    `1. 用户选中该工具通常就意味着希望发起解析:材料齐备、且用户本轮没有表达其他明确意图时,**直接调用,不要犹豫、不要反复向用户确认是否解析**。`,
    `2. 用户本轮明显在做别的事(询问概念、闲聊、查询已提交任务的进度/结果等):正常回应即可,**不要调用解析工具**;查询进度走下方查询仪式(get_task_result)。`,
    `3. 已经提交过解析任务后,**不要因为该模式仍在而重复提交**——除非用户明确要求重新解析/再跑一次。`,
    `4. 当前**没有任何可用附件**(或缺少${outlineRole ? `${outlineRole}/逐字稿` : "逐字稿"}):不要调用工具,直接回复请用户上传所需材料并说明需要什么;材料补齐后再按第 1 条调用。`,
    ``,
    `材料 = 会话中**所有** [附件] 区块列出的文件(多轮添加的合起来才是全部可用文件)。`,
    ``,
    `参数填写:`,
    ...paramLines,
    ``,
    `调用纪律(2026-07-07 起,违反即事故):`,
    `- 必须由你**直接**调用该工具。严禁通过 task 子代理、shell/命令行、HTTP 请求等任何其他方式模拟或代替调用(这些途径本轮已被禁用)。`,
    `- 若该工具不在你的可用工具列表里,或调用返回「工具不可用」类错误:如实告知用户「内网 MCP 连接暂不可用,请稍后重试或联系管理员」。用户已经在输入框完成了选择,**不要再让用户去点击任何按钮**,也不要尝试任何替代方案。`,
    `- task_id 只能来自工具的真实返回,**绝不允许编造**;没有成功的工具返回,就没有 task_id、没有"任务已提交"。`,
    `- 消息里的 [MCP声明] 段落是给系统读取的机器内容,不要向用户提及或复述它。`,
    ``,
    `文件引用铁律:文件参数只能填 [附件] 区块里的文件名,绝不要填写、复述或改写任何 URL/网址/S3 地址;也不要把清单里的本地路径填进去。`,
    ``,
    `长任务规则:该工具是长任务,调用会在几秒内返回 task_id。拿到 task_id 后立即结束本轮:向用户原样转述工具返回的友好文案,不要再调用任何其他工具——尤其不要紧接着调 get_task_result(刚提交的任务立刻查询只会得到排队状态,浪费 token 且误导用户)。`,
    ``,
    `后续查询仪式(适用于本会话之后的轮次):只有用户明确说「查询任务 X」「好了吗」「看看进度」这类话时,才调用 get_task_result;用户每次索取进度/结果都必须重新调用一次该工具——哪怕之前已查到 completed、结果还在上文,也绝不凭记忆作答、绝不让用户去翻上面的旧消息看卡片(文件卡片只在本轮工具真的返回 resource_link 时渲染在当前回答下方,重新调用才能把结果就近呈现)。`,
    ``,
    `异步任务结果回复格式(get_task_result 返回 completed 时强制):≤100 字自然语言,从返回的 text 摘要直接转述(可裁剪不可扩写),结尾加一句「详见下方文件卡片」。pending/processing:转述摘要(≤30 字),请用户稍后再查,此时不要提"下方文件卡片";failed:转述错误说明,不扩展、不替用户分析原因;stopped:单句确认。任何情况下严禁:在回复里 inline JSON/Markdown 表格/HTML/mermaid/任何代码块;解读、复述或重新组织返回数据结构;把 resource_link 的 uri 打进对话——这些内容用户都会在卡片里完整看到,对话里重复就是污染。`,
  ].join("\n")
}
