import "../octo-tokens.css"
import { createSignal, For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { QuestionDockView } from "../components/question-dock"
import { PermissionDockView } from "../components/permission-dock"

/**
 * Dev-only 样张:question 工具答题弹窗(InsightQuestionDock,SPEC-INS-025)。
 *
 * 路由:/insight/__dev/question-dock(见 routes.tsx)。
 *
 * 真机触发条件是「模型调 question 工具 → 服务端 Question.ask 阻塞询问」,依赖 SDK / Sync / 模型,
 * dev 环境难稳定复现(且提示词未引导模型调用)。这里直接渲染从 question-dock.tsx 剥出的纯展示层
 * QuestionDockView(与线上同一组件、同一 message-part.css + question-dock.css 样式),喂 mock 数据
 * —— 所见即所得,刷 UI 不会与线上漂移。
 *
 * 对应 spec §验证:V1(组件层)、V3(长答案回归)、V6(与 permission dock 共存)。
 */

type QuestionItem = QuestionRequest["questions"][number]

// 与真实注入方一致的文案(取自 ui i18n zh.ts / app i18n zh.ts)
const LABELS = {
  dismiss: "忽略",
  back: "返回",
  next: "下一步",
  submit: "提交",
  typeOwnAnswer: "输入自己的答案",
  customPlaceholder: "输入你的答案...",
  singleHint: "选择一个答案",
  multiHint: "可多选",
  questions: "问题",
  progress: (current: number, total: number) => `${current}/${total} 个问题`,
}

const SCENARIOS: { title: string; desc: string; questions: QuestionItem[] }[] = [
  {
    title: "单问题 · 单选(最常见)",
    desc: "带 description 的选项;底部只有「忽略」+「提交」",
    questions: [
      {
        question: "本次分析要聚焦哪个维度?",
        header: "分析维度",
        multiple: false,
        options: [
          { label: "关键发现", description: "提炼访谈中最值得注意的结论" },
          { label: "按提纲聚类", description: "按访谈提纲把观点归到各题目下" },
          { label: "用户画像", description: "刻画受访者特征与典型行为" },
        ],
      },
    ],
  },
  {
    title: "双问题 · 分页(单选 + 多选)",
    desc: "验证「1/2 个问题」进度、进度点可点击跳题、返回/下一步/提交切换",
    questions: [
      {
        question: "本次分析要聚焦哪个维度?",
        header: "分析维度",
        multiple: false,
        options: [
          { label: "关键发现", description: "提炼最值得注意的结论" },
          { label: "评估打分", description: "按维度给出评分与依据" },
        ],
      },
      {
        question: "结果需要包含哪些产物?(可多选)",
        header: "产物形式",
        multiple: true,
        options: [
          { label: "Markdown 报告", description: "结构化正文,便于二次编辑" },
          { label: "思维导图", description: "观点层级关系可视化" },
          { label: "Excel 明细表", description: "逐条观点带出处与标签" },
        ],
      },
    ],
  },
  {
    title: "⚠️ 长答案回归(spec §长答案渲染)",
    desc: "超长中文 label + 长不断词串(URL / 路径)。断言:整行铺开、换行不溢出、不做词组胶囊",
    questions: [
      {
        question: "请选择要作为分析基准的资料来源(注意这一题的选项文本刻意做得很长,用于验证换行)",
        header: "资料来源",
        multiple: false,
        options: [
          {
            label:
              "2025 年第二季度算子开发工具用户满意度专项调研访谈观点聚类与评分明细汇总表最终确认版本(含全部受访者原始逐字稿)",
            description:
              "这条选项的标题刻意超过 120 字中文,用来验证 option-label 在整行铺开布局下能正常换行、不撑破容器、也不被截断成省略号。",
          },
          {
            label: "https://intranet.example.com/research/2025Q2/interview/transcripts/aggregated-final-v3-confirmed.xlsx",
            description: "长 URL:不断词串,验证 overflow-wrap: anywhere 生效(上游 option-label 缺这条,由 question-dock.css 补)",
          },
          {
            label: "D:\\一级部门\\二级部门\\用户研究组\\2025Q2\\算子开发工具访谈观点聚类与满意度评分明细汇总表最终版.xlsx",
            description: "长 Windows 路径",
          },
        ],
      },
    ],
  },
  {
    title: "选项多 · 选项区滚动",
    desc: "超过 --question-prompt-max-height 时选项区自身滚动(无滚动条),整体框不被撑高",
    questions: [
      {
        question: "选择要纳入本次分析的访谈对象",
        header: "受访者",
        multiple: true,
        options: [
          { label: "受访者 A(资深算法工程师,5 年经验)", description: "访谈时长 62 分钟" },
          { label: "受访者 B(前端工程师,2 年经验)", description: "访谈时长 45 分钟" },
          { label: "受访者 C(数据科学家,8 年经验)", description: "访谈时长 71 分钟" },
          { label: "受访者 D(产品经理,4 年经验)", description: "访谈时长 50 分钟" },
          { label: "受访者 E(测试工程师,3 年经验)", description: "访谈时长 38 分钟" },
          { label: "受访者 F(运维工程师,6 年经验)", description: "访谈时长 55 分钟" },
          { label: "受访者 G(设计师,3 年经验)", description: "访谈时长 43 分钟" },
        ],
      },
    ],
  },
  {
    title: "custom: false(不允许自定义答案)",
    desc: "schema 的 custom 显式为 false 时,不渲染「输入自己的答案」行(上游 dock 恒显示,这里按 schema 尊重)",
    questions: [
      {
        question: "是否将本次结果写入会话产物目录?",
        header: "写入产物",
        multiple: false,
        custom: false,
        options: [
          { label: "是", description: "生成文件并落到文件管理" },
          { label: "否", description: "只在对话里给出结果" },
        ],
      },
    ],
  },
]

function Stage(props: { title: string; desc: string; children: JSX.Element }): JSX.Element {
  return (
    <div
      style={{
        background: "var(--octo-surface-page, #fff)",
        "border-radius": "var(--octo-radius-md, 8px)",
        border: "1px solid var(--octo-border-divider, #eee)",
        padding: "20px",
        "margin-bottom": "20px",
      }}
    >
      <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--octo-text-strong)", "margin-bottom": "2px" }}>
        {props.title}
      </div>
      <div style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "margin-bottom": "16px" }}>
        {props.desc}
      </div>
      {/* 复刻输入区宽度:真实 dock 挂在 max-width 800px 的居中输入区上方 */}
      <div style={{ "max-width": "800px" }}>{props.children}</div>
    </div>
  )
}

export default function QuestionDockDevPage(): JSX.Element {
  const [busy, setBusy] = createSignal(false)
  const [last, setLast] = createSignal("")

  return (
    <div
      class="size-full overflow-y-auto"
      style={{ background: "var(--octo-shell-bg, #f5f6f8)", "font-family": "var(--octo-font, system-ui)" }}
    >
      <div class="mx-auto" style={{ "max-width": "920px", padding: "40px 24px 96px" }}>
        <A
          href="/insight/__dev"
          style={{ "font-size": "12px", color: "var(--octo-text-secondary)", "text-decoration": "none" }}
        >
          ← 返回 Dev 预览索引
        </A>
        <div
          style={{
            "margin-top": "10px",
            "margin-bottom": "6px",
            "font-size": "22px",
            "font-weight": 600,
            color: "var(--octo-text-strong)",
          }}
        >
          question 工具 · 答题弹窗
        </div>
        <div style={{ "margin-bottom": "20px", "font-size": "13px", color: "var(--octo-text-secondary)" }}>
          渲染真实 QuestionDockView(线上同组件同样式),mock 数据。提交/忽略不发请求,只回显结果;
          可勾选 busy 预览禁用态。键盘:↑↓ 移动 · Esc 忽略 · ⌘/Ctrl+Enter 下一步。
        </div>

        <label
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "8px",
            "margin-bottom": "24px",
            "font-size": "13px",
            color: "var(--octo-text-strong)",
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={busy()} onChange={(e) => setBusy(e.currentTarget.checked)} />
          busy(应答中,按钮禁用)
        </label>

        <div
          style={{
            "min-height": "20px",
            "margin-bottom": "16px",
            "font-size": "13px",
            color: "var(--octo-accent, #2563eb)",
            "overflow-wrap": "anywhere",
          }}
        >
          {last()}
        </div>

        <For each={SCENARIOS}>
          {(s) => (
            <Stage title={s.title} desc={s.desc}>
              <QuestionDockView
                questions={s.questions}
                busy={busy()}
                labels={LABELS}
                onReply={(answers) =>
                  setLast(`「${s.title}」提交:${answers.map((a, i) => `Q${i + 1}=[${a.join(" / ") || "未答"}]`).join("  ")}`)
                }
                onReject={() => setLast(`「${s.title}」已忽略(reject)`)}
              />
            </Stage>
          )}
        </For>

        {/* V6:与 permission dock 共存 —— 两块是同级兄弟节点,正常纵向堆叠,不重叠 */}
        <Stage
          title="V6 · 与权限弹窗共存"
          desc="模型并行发多个 tool call、或 task 子代理触发权限时会同时 pending。断言:纵向堆叠不重叠、输入区不被顶出视口"
        >
          <PermissionDockView
            title="需要权限"
            hint="AI 需要读取工作区以外的本地文件(路径见下方),经您允许后才会读取。"
            patterns={["D:\\研究资料\\2025Q2\\访谈原始记录.docx"]}
            labels={{ deny: "拒绝", always: "始终允许", once: "允许一次" }}
            onDecide={(r) => setLast(`共存场景 · 权限选择:${r}`)}
          />
          <QuestionDockView
            questions={SCENARIOS[0]!.questions}
            busy={busy()}
            labels={LABELS}
            onReply={(answers) => setLast(`共存场景 · 答题提交:[${answers[0]?.join(" / ") || "未答"}]`)}
            onReject={() => setLast("共存场景 · 答题已忽略")}
          />
        </Stage>
      </div>
    </div>
  )
}
