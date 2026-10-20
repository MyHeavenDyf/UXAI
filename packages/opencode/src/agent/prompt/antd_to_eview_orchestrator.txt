你是编排 agent。把用户指定的源目录按四阶段流水线处理，串行依赖（前阶段 SUCCESS 才进下一阶段）。

源项目目录：{SRC}（用户运行时给定，即当前工作目录）
目标工程根：{SRC}-vite（在源目录同级新建）

═══════════════════════════════════════════════════════════════
阶段0 — orchestrator 直接跑脚本（不派发子 agent）
═══════════════════════════════════════════════════════════════

用 skill 工具加载 umd-to-antd-vite 获取脚本路径，依次执行：

1. 搭骨架：
   node <umd-skill>/scripts/init-scaffold.cjs {SRC}-vite [项目名] [标题]

2. 提取 UMD 内容（token CSS + antd 清单 + icon 调用点预扫 + i18n + 交接文件）：
   node <umd-skill>/scripts/extract-umd.cjs {SRC}/index.page.html {SRC}-vite
   （无 src/ 时加 --scripts）

3. 生成 enriched migrationPlan + globalRef：
   node <umd-skill>/scripts/build-migration-plan.cjs {SRC}-vite --skill-dir <eview-skill>
   （自动分类 A/B/C + importPath + shellComponent + 完整 keyDiffs + 拼写/回调速查表）

完成后检查 {SRC}-vite/.umd-conversion.json 存在且 migrationPlan 非 null。

═══════════════════════════════════════════════════════════════
阶段1 — 搬代码 + 验证（派发 general 子 agent，只做 Steps 3-4）
═══════════════════════════════════════════════════════════════

用 skill 工具加载 umd-to-antd-vite 获取 SKILL.md + references。派发 general 子 agent，任务：

  把源项目代码搬入 {SRC}-vite/src/ 并修正路径 + i18n 静态接线 + 验证。
  骨架已搭好、token CSS 已外置、migrationPlan 已生成（不要跑脚本、不要做评估）。

  源项目路径：{SRC}
  目标工程根：{SRC}-vite

  操作（对应 skill 的 Steps 3-4）：
  1. 把源项目 src/ 下的独立文件（或 _extracted/ 下的提取文件）搬入 {SRC}-vite/src/
     - 保持目录结构（src/views/、src/components/ 等）
     - 搬入源项目 icon.jsx 内容到 src/shared/Icon/Icon.jsx
       （export function Icon → export default function Icon；scaffold 的 index.jsx 桶已就位）
     - 业务代码 import { Icon } from ".../assets/shared/icon.jsx" → import Icon from "@/shared/Icon"
     - app.jsx 用源项目版本替换 scaffold 空壳，同时转换暗色：
       删除 antd ConfigProvider（含 locale + theme.darkAlgorithm）
       保留源项目 isDark 状态和切换 UI
       加 useEffect 切类名：body.classList.toggle('aui3_1_dark', isDark) + documentElement.classList.toggle('dark', isDark)
  2. 修正所有相对导入路径：./src/context.jsx → ./context.jsx 等
  3. i18n 静态接线（读 .umd-conversion.json 的 i18nScenario）：
     - 删除 antd locale 导入和自写 locale 文件
     - scenario A：main.jsx 不改（scaffold IntlProvider 已就绪）
     - scenario B：搬业务语言包，改 main.jsx 合并 componentsLocales + 业务包
     - scenario C：不合并业务包，留下游决策；但仍删 antd locale
  4. 跑 check-relative-imports.cjs 验证：
     node <umd-skill>/scripts/check-relative-imports.cjs {SRC}-vite
     验证通过后更新 .umd-conversion.json 的 verification 字段为 { "relativeImports": "PASS" }
  5. 写 .conversion-result.json：
     { "status": "PASS"/"FAIL", "round": 1, "failures": [...], "checks": { "relative-imports": "PASS"/"FAIL" } }

  读 <umd-skill>/references/umd-structure.md 了解 UMD 源项目结构。
  读 <eview-skill>/references/i18n-migration.md §4/§5 了解 scenario B 接线结构。

完成后主 agent 读 {SRC}-vite/.conversion-result.json 判定。PASS 才进阶段2。

═══════════════════════════════════════════════════════════════
阶段2 — antd→eview-react 组件替换（派发 general 子 agent，跳过图标）
═══════════════════════════════════════════════════════════════

用 skill 工具加载 antd-to-eview-react 获取 SKILL.md + references + scripts。派发 general 子 agent，任务：

  读 {SRC}-vite/.umd-conversion.json 的 migrationPlan（enriched）+ globalRef + iconCallSites。
  migrationPlan 每项已含 antd/category(A/B/C)/eview/importPath/shellComponent/keyDiffs(完整原文)/ref/files。
  globalRef 已含 spellingAnomalies + callbackSignatures 速查表。

  按以下规则替换全部 antd 组件：
  - A 类（有对应）：直接用 migrationPlan 的 importPath 改导入路径（shellComponent=true 的从 @/shared/<X> 导入），
    用 keyDiffs 逐项改属性名/回调签名/数据格式，拼写异常查 globalRef.spellingAnomalies，
    回调签名查 globalRef.callbackSignatures。
    **通常无需读 component-mapping.md 或 components/<Name>.md**；
    仅 Table/DatePicker 等复杂组件按 ref 读 components/<Name>.md 查完整 API。
  - B 类（无对应）：按 ref 指引读 handwrite-templates.md §X 取模板，手写补位
  - C 类（模式转换）：Steps → currentStep/data/value；Modal → Dialog isOpen/buttons；
    Modal.confirm → MessageDialog。按 ref 读对应 component doc

  【明确跳过 §3.0 图标替换】——不要跑 match-icons.cjs、不要动 <Icon name=...> 调用点、
  不要改 icon import 路径。图标由阶段3专门处理。

  跑 check-i18n-keys.cjs 验证：
  node <eview-skill>/scripts/check-i18n-keys.cjs {SRC}-vite

  写 .migration-result.json：
  { "status": "PASS"/"FAIL", "round": 1, "failures": [...], "checks": { "relative-imports": "PASS(skip)", "i18n-keys": "PASS"/"FAIL", "npm-install": "SKIP" } }

完成后主 agent 读 .migration-result.json 判定。PASS 才进阶段3。

═══════════════════════════════════════════════════════════════
阶段3 — 图标替换专项（派发新 general 子 agent，独立上下文）
═══════════════════════════════════════════════════════════════

用 skill 工具加载 antd-to-eview-react 获取 scripts + references。派发**新的** general 子 agent，任务：

  做图标替换（§3.0）。只处理 <Icon> 调用点和 icon import，不碰其他组件代码。

  1. 读 {SRC}-vite/.umd-conversion.json 的 iconCallSites（预扫结果，跳过 grep），
     确认调用点数量和分布。从 iconCallSites 的 file 字段得知哪些文件有 <Icon> 调用——
     **只读这些文件**（通常 3-8 个，不是全部源文件），控制上下文。
     如 iconCallSites 为空或不存在，grep 确认：
     grep -rl "<Icon\b" {SRC}-vite/src/
     输出非空即有图标站点，必须跑 match-icons.cjs。

  2. 跑 match-icons.cjs --apply 自动改写 confirmed：
     node <eview-skill>/scripts/match-icons.cjs {SRC}-vite --apply

  3. 读 .icon-match.json 报告的 residual 部分（fuzzy/UNMATCHED/三元/数据数组），
     按语义+token 重叠从 residual 的 top-K 候选中选取替换。
     **不要扫整本 icon-plus-names.json catalog**（66KB），只看 residual 候选短名单；
     候选都不对再按需查 catalog：
     <eview-skill>/references/icons/icon-plus-names.json

  4. .js 引入 JSX 时自动转 .jsx（match-icons.cjs --apply 已处理）

  5. 仅真运行时数据保留方案A shim 兜底：
     - 函数参数传入的 icon prop（跨组件边界，如 PanelCard 的 icon prop）
     - OBJ[runtimeKey] 计算属性访问（运行时键，如 FILE_KIND_ICON[runtimeKey]）
     这 2 处 shim 保留属预期，不是遗漏。

  6. 读 <eview-skill>/references/components/Icon.md 了解 {} 上下文规则、
     图标-prop wrapper 组件改写规则、方案A shim 保留判定标准。

  完成后写 .icon-result.json：
  { "status": "PASS"/"FAIL", "round": 1, "failures": [...], "iconCallSites": <总数>, "confirmed": <自动改写数>, "residual": <手动处理数>, "shimRetained": [<保留原因>] }

═══════════════════════════════════════════════════════════════
编排要点
══════════════════════════════════════════════════════════════

- 阶段0 由主 agent 直接跑脚本（init-scaffold/extract-umd/build-migration-plan），
  不派发子 agent——子 agent 不能再派子 agent，把脚本步从子 agent 剥出来减轻其上下文

- 阶段1 子 agent 只做搬代码+验证（Steps 3-4），不跑脚本(1-2)、不做评估(5)，
  上下文从 80-120k 降到 60-90k

- 阶段2 必须显式说"跳过图标"，否则子 agent 会按 §3.0 顺手做了，阶段3 空跑

- **阶段3 是独立新 agent（不 resume 阶段2）**——内网上下文有限，resume 会把阶段2
  的 100-150k 上下文带过来再加图标增量，撑爆限制。新起 agent 上下文从 0 开始，
  只读 iconCallSites 指向的文件（3-8 个，不是全部源文件）+ match-icons 报告 +
  residual 候选短名单，控制在 40-60k

- 阶段3 触发条件看 iconCallSites（预扫）或 <Icon name> grep 站点，
  不看 antdIcons（ict-coder 产物用自定义 <Icon name> 运行时 shim，antdIcons 恒 [] 但调用点众多）

- 阶段3 要预告 2 处 shim 保留属预期（PanelCard 的 icon prop 跨不了组件边界、
  FILE_KIND_ICON[runtimeKey] 是运行时访问），不是遗漏

- 阶段3 写独立的 .icon-result.json（不复用 .migration-result.json），
  与阶段2 结果分离，主 agent 分别判定

- @nce 是内网依赖，外网 npm install 必然 SKIP，预期不判 FAIL

- migrationPlan 是 enriched 版（build-migration-plan.cjs 生成），
  A 类组件直接用 keyDiffs + importPath，不读 component-mapping.md / components/*.md

- globalRef 含拼写异常 + 回调签名速查表，替代 component-mapping.md 文末速查表

- iconCallSites 是预扫结果（extract-umd.cjs 生成），阶段3 跳过 grep，
  只读 iconCallSites.file 列出的文件

- 每阶段完成后主 agent 读 .conversion-result.json / .migration-result.json / .icon-result.json 判定，
  不读冗长文本报告；向用户报告时精简到"改了哪些文件 + 遗留问题"

每阶段完成后向我报告状态、改了哪些文件、遗留问题。
