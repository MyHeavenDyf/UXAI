// MCP 功能定义(原预置提示词) - 见 SPEC-INS-007 §3.1、SPEC-INS-017 §1/§3
//
// SPEC-INS-017 后角色变化:
// - 不再是"点击填文案进输入框"的胶囊行(模型隐式选工具已废,MCP 业务工具退出非 chip turn 的
//   模型工具集),而是输入框 MCP chip 菜单的功能清单(用户显式选功能,单 turn 触发)
// - expectedTool 从"追踪/调试用"升级为触发主键:chip 模板指定调用该工具、tools gate 只放行它、
//   [MCP声明] 按它对齐文件参数(octo-upload-inject 强制覆盖)
// - text 保留:用户没输入文字时作为该 turn 的可见文案(气泡里显示的内容)

export type PresetPrompt = {
  id: string                  // 与 expectedTool 同名,便于追踪
  label: string               // chip 菜单项 / 激活态上的短文案
  text: string                // 用户未输入文字时,chip turn 的可见气泡文案
  expectedTool: string        // 触发的 MCP tool 名(不含 server 前缀;SPEC-INS-017 §2)
  categories: string[]        // 外网将按 category 过滤;本期 octo 不读但 schema 要预留
  description?: string        // 可选 tooltip
  /** 选中该功能时输入框的 placeholder(设计稿:按工具提示要上传什么材料)。
   *  当前为占位文案,正式文案待设计师给出(登记于 design-assets-needed.md)。 */
  placeholder: string
  /** 多角色工具:除逐字稿外还需一个大纲/任务书文件。分桶归**模型**(拿不准时向用户确认,
   *  SPEC-INS-017 2026-07-06 修订),此字段用于模板措辞与声明的 outline_required 校验。 */
  outlineRole?: string        // 该角色的业务名称,如 "访谈大纲" / "任务书"
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "key_findings",
    label: "观点解析",
    expectedTool: "key_findings",
    categories: ["interview"],
    text: "观点解析(key findings)：基于上传的逐字稿，解析用户观点。",
    placeholder: "请上传需要解析的逐字稿，支持 .docx、.txt、.md 格式",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "按提纲聚类(run guide analysis)：基于上传的访谈大纲和逐字稿，聚类用户观点。",
    placeholder: "请上传访谈大纲和逐字稿，支持 .docx、.txt、.md 格式",
    outlineRole: "访谈大纲",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "思维导图(mindmap)：基于上传的逐字稿，生成思维导图。",
    placeholder: "请上传需要生成思维导图的逐字稿，支持 .docx、.txt、.md 格式",
  },
  {
    id: "run_usability_analysis",
    label: "可用性问题分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "可用性问题分析(run usability analysis)：基于上传的任务书和逐字稿，分析整理可用性问题。",
    placeholder: "请上传任务书和逐字稿，支持 .docx、.txt、.md 格式",
    outlineRole: "任务书",
  },
]
