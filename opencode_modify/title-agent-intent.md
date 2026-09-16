# Title agent 标题改为用户意图描述

## 概述

会话标题由 `title` agent（small model + `title.txt` 提示词）在第一轮对话时异步生成。原提示词的规则（"不要只复述用户原话"）和示例（`Auth加Token`、`查config`）偏向关键词压缩风格，生成的标题不能体现用户想做什么。

本次将标题风格调整为"简短描述用户的需求（用户意图）"，保持不超过 10 个字，并针对弱模型容易超出字数限制的问题，在提示词多处位置强化硬性约束。

## 涉及文件

| 文件 | 修改 |
|------|------|
| `packages/opencode/src/agent/prompt/title.txt` | 重写任务描述、规则与示例，转向意图式标题；三处强化 ≤10 字硬约束 |
| `packages/opencode/src/session/prompt.ts` | `ensureTitle` 中注入给 LLM 的用户消息前缀同步改为"简短描述用户的需求 + 严格不超过 10 个字"；新增导出 `cleanTitleText` 清洗函数并替换内联清洗 |
| `packages/opencode/test/session/title-clean.test.ts` | 新建，`cleanTitleText` 纯函数单测（14 用例） |
| `opencode_modify/title-agent-intent.md` | 记录本次修改 |

## 实现

### title.txt

- 任务：由"总结用户的需求，生成一个简短的中文标题"改为"用一句简短的中文描述用户的需求，即用户想做什么"。
- 规则调整：
  - 删除"不要只复述用户原话"，改为"可以贴近用户原话表述，但去掉寒暄、语气词和冗余字"。
  - 新增"描述用户的意图，即用户想完成的事情，让标题读成一句通顺的需求描述"。
  - 新增字数硬约束："标题长度硬性不超过 10 个字符（汉字、字母、数字、符号均按 1 个字符计算），超出时必须删减到 10 个字符以内"，并补充"若 10 个字符放不下（技术术语），优先缩短文件名或精简术语"。
- 示例全部改为意图式描述并加引导行"以下所有示例标题都不超过 10 个字符"：如 `@src/auth.ts 能否加 refresh token 支持 → 增加token刷新支持`、`@App.tsx 加暗色模式切换 → 增加暗色模式切换`。
- 弱模型字数超限问题：在输出要求（"严格不超过 10 个字符，这是硬性约束"）、`<rules>` 首条、示例引导行和文件结尾（"再次强调：……超过 10 个字符即为错误输出"）共四处重复强调。

### prompt.ts

`ensureTitle`（`SessionPrompt.ensureTitle`）调用 `llm.stream` 时拼接在历史消息前的用户消息前缀，由"请总结用户需求，生成一个不超过10个字的中文标题"改为"请简短描述用户的需求，生成一个中文标题，标题必须严格不超过10个字，超过10个字即为错误"，与 title.txt 的意图描述和硬约束保持一致。

代码层 `cleaned.length > 100` 的截断保留为安全兜底，未改为 10 字符硬截断——硬截断会把英文术语截断成破碎单词（如 `增加refresh t`），提示词强化是主要手段。

## 标题清洗强化（防 thinking 泄漏）

### 背景

本部署的内部网关（opencode/bpit/w3，全部 `@ai-sdk/openai-compatible`）不分离 reasoning，thinking 模型的思考会直接混进 content 文本流（`text-delta` 事件）。事件层（`ensureTitle` 只收集 `text-delta`、丢弃 `reasoning-delta`）对这类模型无效，唯一的防线是文本层清洗。原实现只有一条闭合 `<think>` 对的正则，存在 4 类失效场景：

1. 未闭合 `<think>`（token 截断/流中断/模型漏写闭标签）——思考整段成标题；
2. `<thinking>` 变体标签；
3. `<Think>`/`</THINK>` 大小写变体；
4. ```` ```think ```` 代码块包裹。

另外标题模型解析链：title agent 无 model → `cfg.small_model` → `getSmallModel` 优先级匹配（本部署内部模型全部 miss）→ 回退用户当前模型；且 `small: true` 时 `ProviderTransform.smallOptions` 对所有 openai-compatible 网关返回 `{}`，标题请求不携带任何思考控制参数——用户当前模型是 thinking 模型时即暴露。

### 实现

`packages/opencode/src/session/prompt.ts`：

- 新增文件级导出纯函数 `cleanTitleText(text: string): string | undefined`（置于 `readActivatedSkills` 之后，同样以 `@internal Exported for testing` 注释导出），七步清洗管道，**顺序关键**——闭合块先剥、残留开标签再"删到结尾"，否则未闭合规则会误杀闭合块之后的正文：
  1. 剥闭合块 `/<(think|thinking)\s*>([\s\S]*?)<\/\1\s*>/gi`（反向引用保证开闭配对，`i` 覆盖大小写）；
  2. 剥开头孤立闭合标签 `</think>正文`（vLLM 部署 deepseek-r1 的已知输出形态）；
  3. 未闭合开标签 → 删到结尾；
  4. 剥闭合 ```` ```think/```thinking ```` 代码块；
  5. 未闭合 fence → 删到结尾；
  6. 取首个非空行；
  7. **超长即弃**：首行 >30 字符（title.txt 要求 ≤10 字的 3 倍容错）视为思考泄漏/失败输出，返回 undefined 放弃本次标题，会话保持默认标题（`ensureTitle` 仅在标题为默认值时触发，放弃无害，用户可手动改名）。
- `ensureTitle` 内联清洗（原 240-246 行）替换为 `cleanTitleText` 调用，同时**删除原 100 字符截断**（`substring(0, 97) + "..."` 只会产出破碎标题，被 30 字即弃取代）。

### 测试

新建 `packages/opencode/test/session/title-clean.test.ts`（bun:test，经 `SessionPrompt` 命名空间导入，模式同 `skill-activation.test.ts`），14 个用例覆盖上述全部场景：纯文本、闭合/多个闭合块、未闭合（放弃/保留前置正文）、`<thinking>`、大小写、孤立闭合标签、闭合/未闭合 fence、首行提取、12 字符轻微超标保留、>30 字裸思考放弃、空输入。

### 验证

- `bun run --cwd packages/opencode test test/session/title-clean.test.ts` — 14 pass / 0 fail；
- `bun run typecheck` — 12/12 successful。

遗留边界（未处理，需单独决策）：confirm-plan 走 `session.command` 的模板 part 为服务端注入的非 synthetic（`resolvePromptParts`，prompt.ts:144），其 SKILL.md/方案全文仍会进入标题上下文；如需剥离须给 command 模板 part 打 synthetic 标记，但会影响所有 agent 的 command 消息 real 判定。

