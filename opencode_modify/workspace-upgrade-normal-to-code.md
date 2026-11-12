# 普通工作区原地升级为代码工作区(normal → code)

> 分支 `feat/workspace-upgrade`(自 dev_dyf 切出)。
> 动机:2026-10-19 起新建 workspace 默认 kind=code 且分类"选定不可更改"(setKind 已删),
> 存量普通工作区及其历史会话无法享受代码工作区语义(产物直接写项目内、文件面板浏览项目树)。
> 本功能提供**单向原地升级**:目录不变、历史会话留在原地,kind 翻转为 code,历史产物文件
> 从 `.octo/<sid>/outputs` **按会话目录保留原结构复制**到 `<workspace>/output/<sid 前 12 位>/`,
> 并改写 DB 中 message/part 的路径引用;**原 `.octo/<sid>/outputs` 目录保留不删**。

## 最高原则(同 session-chat-migration)

对用户数据务求稳妥:宁可中断并明确报错,绝不造成不可逆的数据丢失。

1. **原件永不删除、目标文件绝不覆盖** —— `.octo/<sid>/outputs`(含 uploads)原样保留;
   未被改写的引用仍可经 .octo 会话式 serve 打开,天然兜底
2. **DB 只 UPDATE message/part 的 data 列** —— session 三列(directory/project_id/path)
   一律不动;kind(normal/code)是纯前端标记,服务端不感知,翻转在前端 store 做
3. **备份先行**(VACUUM INTO 整库快照),写前校验备份可读且含本次要改的行

## 迁移协议

顺序不能变:**命名规划(纯只读)→ 备份+校验 → 复制(建目录+拷文件)→ 事务改写+自检**。

- 规划/备份失败还没动过任何数据(plan 零写入,备份失败时文件系统根本没被触碰)
- 复制失败:原件不动、本次新建副本已清(rmdir 本次新建的目录链,只有空目录删得掉)
- 改写失败:事务回滚 + 副本清理,数据保持升级前状态
- 原 .octo 产物目录全程不删

### 文件迁移

- `<ws>/.octo/<sid>/outputs/**` 递归收集(目录不存在/读不了 → 该会话无产物);
  **`.` 开头的文件与子目录一律跳过** —— `.gitkeep`(空目录占位)、`.history/**`(编辑器
  本地历史快照)是内部文件,既不计数也不迁移(与项目文件列表过滤 `.` 条目口径一致;
  实测 D:\octoAI\merge 曾因此把 2 个真产物数成 6)
- **复制**(不是移动)到 `<ws>/output/<sid 前 12 位>/<原相对路径>`,保留目录结构与文件名:
  - sid 前 12 位 = `ses_` 之后的时间戳+计数器 hex 段,同毫秒创建也不重复(id.ts),
    且不随 base62 随机段变化,重跑命名稳定;形态异常的 id 兜底用整串
  - 去掉 outputs 层级:`.octo/<sid>/outputs/sub/a.html` → `output/<前缀>/sub/a.html`;
    跨会话同名天然隔离(每会话独立目录),文件名不再加前缀重命名
  - **撞名 = 中断报错**(stage=plan):目标已存在且内容不同(异常状态,盘上有异内容
    同名文件)→ 抛错不动任何数据,挪走冲突文件重跑即可。**不做 -2 后缀改名** ——
    后缀会击穿「迁移落盘名 ↔ 前端 text 卡片推导」的逐字一致不变量(见 2026-10-22 节)
  - 盘上已有且内容相同(先比大小再逐字节)→ 复用不复制(重跑幂等)
  - 目录创建在复制阶段(mkdir recursive 幂等);plan 记录 createdDirs(本次需新建的
    目录链),失败清理时按深度降序 rmdir,只删本次新建的空目录

### DB 路径改写

- 改写范围 = `directory === <ws>` 且 `agent ≠ 'octo_studio'` 的**全部**会话(含子会话/
  归档)的 message/part 行 —— 覆盖会话间交叉引用(子会话引用父会话产物)
- 旧路径变体(每文件 4 个):绝对/相对 × 正斜杠/反斜杠;新值统一
  `<ws>/output/<sid 前 12 位>/<原相对路径>`(正斜杠绝对路径,与代码工作区 link artifact
  惯例及前端推导一致)
- 替换在**原始 JSON 文本**上做(不 parse/stringify,避免 round-trip 风险);按变体**长度
  降序**应用(abs 变体包含 rel 子串,先替换 rel 会拼出 `D:/ws/D:/ws/output/...` 坏路径);
  DB 层 instr 自检用反斜杠转义后的变体(JSON 里 `\` 存为 `\\`)
- **映射不到的引用不动**(磁盘上没有该文件 → 卡片本来就断,保留旧路径经 .octo serve 兜底)
- 事务内写回 + 读回自检:in-scope 会话所有含 `.octo` 的行里,任何已映射变体(转义形态)
  都不得残留,任一残留抛错整体回滚(兜住「rows 算好到提交之间」的并发写入)

### 备份

`VACUUM INTO <dbPath>.ws-upgrade-bak-<ts>`(每次 run 新建一份,永不覆盖;不能在事务内执行)
+ 三条校验:文件存在且非空、能作为 SQLite 打开、in-scope 会话的 message/part 行数与当前库一致。
`:memory:` 库直接拒绝(拿不到库文件)。

### Studio 会话排除

`agent='octo_studio'` 的会话**文件不迁、DB 不改**,只计入 `studioSkipped` 计数:
internel_image_generate.ts 的 localImagePath 白名单只认 .octo,studio 会话式 serve 与
kind 无关,不动即可用,搬了反而会坏。

### 守卫(handler 层)

- 目录校验:trim/绝对路径/path.resolve(**不 realpath** —— directory 全链路原样透传,
  列表查询是 eq 精确匹配,realpath 反而制造口径不一致);目标必须真实存在且是目录
- **实例对齐**:payload directory 必须等于路由到的 instance directory(busy 检查读的是
  路由实例的状态表,查别人家的表等于没查)—— 前端 body_directory 与 query_directory
  传同一个值保证路由正确
- busy 检查:in-scope 会话有运行中(SessionStatus busy/retry)→ 拒绝,提示等待

## 实现文件

### 服务端(packages/opencode)

- `src/session/workspace-upgrade.ts`:核心模块。导出 `collectUpgradeTargets` /
  `previewWorkspaceUpgrade` / `runWorkspaceUpgrade` / `WorkspaceUpgradeError`(stage:
  resolve|busy|backup|verify-backup|plan|copy|rewrite|cleanup)/ `logWorkspaceUpgradeFailure`;
  日志前缀 `[octo:ws-upgrade]`,排查口诀:**看到 failed 就一定没动过数据**
- `src/server/routes/instance/httpapi/groups/workspace-upgrade.ts`:api group
  `/workspace-upgrade/preview|run`,错误 `ApiWorkspaceUpgradeError{stage,message}`(400)
- `src/server/routes/instance/httpapi/handlers/workspace-upgrade.ts`:守卫 + 错误映射
- `src/server/routes/instance/httpapi/api.ts` + `server.ts`:注册
- `test/server/workspace-upgrade.test.ts`:9 用例(preview 计数/studio 排除、按会话目录
  保留结构复制、撞名异内容中断零损伤、四变体改写+嵌套映射+范围外/未映射不动、studio
  原样、零产物早退、幂等重跑、备份快照、备份失败中止零损伤)

### SDK

`bun run --cwd packages/sdk/js build` 重新生成:`client.workspaceUpgrade.preview/run`
(operationId 两段式 `workspaceUpgrade.*`)。

**附带影响**:本次重新生成净删除了 5 个 studio 媒体端点的 SDK 方法
(`/studio/generations/{id}/media/{i}/thumbnail[-source][/invalidate]`、
`/studio/generations/{id}/video-poster`、`/studio/sessions/{id}/thumbnails/ensure`)。
排查结论:这些端点在 httpapi 契约(groups/studio.ts)里有定义,但 `bun dev generate`
导出的 openapi spec paths 里本就没有它们 —— 已提交的 SDK 是旧状态生成的;全仓库
(app/desktop/console/web)无人使用这些 SDK 方法(studio-page.tsx 用裸 fetch 调
thumbnails/ensure),功能无损。另发现 scripts/diff-sdk-types.sh 的 env 变量名错位
(OPENCODE_ vs OCTO_)且两种模式标签写反,未在本次修改。

### 前端(packages/app/octoapp)

- `context/server.tsx`:`projects.upgradeToCode(directory)` —— setStore 翻 kind,单向,
  不提供反向。在 run 成功后调用;kind 驱动的行为(make 注入分流等)全部动态读 store,
  **活跃工作区升级不需要刷新页面**
- `components/settings-general.tsx`:`WorkspaceUpgradeSection`(ChatMigrationSection 之后):
  列出 kindOf=normal 的工作区(名称/`~` 缩略路径),createEffect 逐目录懒加载 preview 计数
  (`globalSdk.client.workspaceUpgrade.preview`,body_directory+query_directory 双传);
  计数展示 `N 个会话 · M 个文件` / `无历史产物` / `预览不可用`
- **preview 明确全 0 的工作区**:点升级直接翻 kind,不调 run、不弹确认(没有要迁移的
  东西,零风险);有产物或预览不可用 → 确认弹窗(说明按会话目录保留结构迁移/先备份/
  不可撤销)→ run → toast(会话数/文件数/backupPath 可自行删除)→ upgradeToCode
- i18n:`settings.workspaceUpgrade.*` 16 键(en+zh,其余 locale 缺键回退英文)
- **入口默认隐藏 — 2026-10-21**:一次性不可逆运维操作,不给普通用户曝光。设置页打开
  期间按 **Ctrl+Shift+U**(Win/Linux)/ **Cmd+Shift+U**(Mac)才显示
  (`wsUpgradeEntryVisible` 模块级 signal,本次应用运行内保持可见,重启恢复隐藏);
  监听用 `event.code === "KeyU"` 防中文输入法 key="Process",preview 懒加载 effect
  同样以该 signal 为门,隐藏时不发预览请求

## 回滚口诀

- `[octo:ws-upgrade] failed` 出现 = 没动过数据,按 stage 修复后重跑(全流程幂等)
- 极端情况:`.ws-upgrade-bak-*` 是整库快照,用 SQLite 工具按行恢复;原件从不删除、
  从不覆盖,DB 改写只动 message/part 的 data 列

## 已知限制(v2)

- **产物文件内容不改写**:html 里的绝对自引用链接(如有)不跟着搬,只有 DB 里的引用改
- **子串替换边界**:同目录存在 `x.html` 与 `x.html.bak` 两个产物时,`x.html` 的变体是
  `x.html.bak` 引用的前缀子串,替换会把后者拼成不存在的 `output/<前缀>/<名>.bak`(卡片断,
  原件保留)。真实数据中产物名带后缀重叠的场景罕见,接受
- **存量平铺升级工作区不二次迁移**:2026-10-21 之前按旧平铺命名(`<前缀>-<原名>`)升级过
  的工作区(kind 已翻 code,不会再触发升级),其 text 卡片经新推导规则落点
  `output/<前缀>/<原名>` 不命中旧平铺文件 → auto-save 会在新位置多写一份(不丢数据、
  旧文件保留)。功能上线 1 天且入口隐藏,受影响面近零,不做双路径探测兼容
- busy/实例对齐守卫在 handler 层,单测只覆盖模块本体(HTTP 层迁移端点测试无先例,
  与 chat-migration 同口径);busy 逻辑已人工核对
- 测试环境注意:`test/server/workspace-upgrade.test.ts` 的 afterEach(disposeAllInstances)
  在 Windows 本机偶发超过 bun 默认 5s hook 超时,表现为一个 "(unnamed)" 偶发红 ——
  基准文件 session-chat-migration.test.ts 同样偶发,环境固有,与用例逻辑无关

## 追加修复:代码工作区 auto-save 落点对齐 output/ 命名 — 2026-10-20

升级后恢复 make 会话时出现**重复产物**:根目录原始名副本 + `output/` 前缀副本各一份。
根因:kind 翻转为 code 后,insight-turn.tsx 的 auto-save createEffect(卡片渲染即触发)
按 code 工作区旧规则(项目根 + 原始名,`computeArtifactFilePath` 的 `[projectDir, filename]`)
落盘,对 output/ 里的迁移副本不可见 → 又写了一份到根目录。

**修复**(前端 `packages/app/octoapp`):`computeArtifactFilePath` 的 code 分支改为
`[projectDir, "output", "<sid 前 12 位>-<原名>"]`,sidPrefix 规则与本模块迁移命名
**逐字一致**(`ses_` 后 12 位 hex,短 id 兜底整串)。auto-save 的"已存在即跳过"策略
随即命中迁移副本,恢复会话不再产生根副本;跨会话前缀也避免同名产物互相覆盖。
(2026-10-22 起落点调整为 `output/<sid 前 12 位>/<原名>`,推导不变量保持,见下节。)

- 单点收口:三个 auto-save 调用点(insight-turn 渲染 effect / make 页开卡 Step -1 /
  tab-persistence 编辑保存)全部经 `computeArtifactFilePath`,改一处全链路生效
- 会话内索引:link 产物卡片引用已被迁移改写到 output/ 绝对路径;text 产物卡片点击时
  Step -1 推断 filePath 命中 output/ 文件直接打开
- 存量边界:2026-10-19 以来新建 code 工作区里已落**项目根**的历史 text 产物副本不迁移
  不删除(仅是不再被 auto-save 复用),后续新产物一律按 output/ 命名落盘
- `opencode_make.txt` 与 [Workspace] 注入段不改:model 用 write 落盘的位置本来就
  "项目内合适位置"任意,auto-save 落点是前端兜底细节,两者不冲突
- 验证:artifact-auto-save.test.ts 13/13(含 12 位前缀截取/短 id 兜底断言)、
  packages/app typecheck 通过、make 注入契约测试 7/7;D:\octoAI\merge 根目录两份
  重复副本确认逐字节一致后删除

### 迁移后卡片 ↔ 文件对应核对(真实数据,D:\octoAI\merge)

text artifact 卡片(DB 里本无路径引用,对应完全靠前端推导)实测三向一致:

- DB 实况:两个 make 会话各产一张 text 卡片(`<artifact identifier type="text/html"
  title="现代注册页">`),message/part 里 `.octo` 旧引用与 `output/` 新引用均为 **0 条**
  (text 卡片内容在 fence 里,迁移改写步骤对其为 no-op)
- 推导核对:`ses_ea78c72beffesyFDY3omLCuC1D` + 标题 `现代注册页` →
  `output/ea78c72beffe-现代注册页.html`,与迁移落盘文件名**逐字一致**——.octo 里的
  原名本就是 normal 时期同一条 title→filename 规则生成的,推导幂等;修复后恢复会话
  auto-save 命中迁移副本即跳过,点击卡片 Step -1 推断 filePath 命中直接打开
- link artifact 卡片(有路径引用的场景)由迁移改写保障:4 变体 → output/ 正斜杠绝对
  路径(单测覆盖);未映射引用保留 .octo 旧路径经会话式 serve 兜底
- 陈旧引用清查:真实 DB 旧引用残留 0、新引用缺失 0;渲染进程 localStorage
  (leveldb)无任何 merge 路径快照——不存在指向已删根副本的陈旧 tab 快照
  (若曾存在,恢复后编辑保存会向旧路径 PUT 重写根副本,属文件搬移类操作固有边界)

## 追加变更:迁移落点改为按会话目录保留结构 — 2026-10-22

需求变更:不再平铺 + 前缀重命名,产物按会话目录完整放入 output,目录结构与文件名原样保留。

- **目标路径**:`.octo/<sid>/outputs/<rel>` → `output/<sid 前 12 位>/<rel>`(去掉 outputs
  层级;前缀做会话目录名,畸形 id 兜底整串;跨会话同名天然隔离,文件名不再加前缀)
- **服务端** `workspace-upgrade.ts`:planFileCopies 重写为纯只读(目录创建移到 copy 阶段,
  备份失败时文件系统零触碰);撞名异内容从 -2 后缀改名改为 stage=plan 中断报错 ——
  后缀会让 DB 引用指向 `x.html-2` 而前端推导指 `x.html`,击穿 text 卡片推导幂等;
  cleanupCreated 扩展为按深度降序 rmdir 本次新建目录链(只删得动空目录)
- **前端** `artifact-auto-save.ts`:computeArtifactFilePath code 分支同步改
  `[projectDir, "output", sidPrefix(sid), filename]`,「迁移落盘名 ↔ 推导」逐字一致的
  不变量保持(normal 期 auto-save 本就落 outputs 根平铺,推导无子目录天然对齐;
  带子目录产物是 write 工件、有 DB 引用,不走标题推导)
- **DB 改写**:4 变体机制与长度降序不变,新值目标嵌套化
  (`<ws>/output/<前缀>/<原相对路径>`)
- **SDK**:groups run description 更新,`bun run --cwd packages/sdk/js build` 重生成
  (diff 恰好一行 description)
- **i18n**:zh/en 的 description 与 confirm.description 改「按会话目录保留原目录结构复制」
- **存量边界**:旧平铺命名升级过的工作区不做二次迁移/双探测,记入已知限制(v2)

## 验证记录

- `bun run typecheck`:opencode / sdk / app 三包通过(全仓 12/12)
- `bun test test/server/workspace-upgrade.test.ts`:8/8 通过
- `packages/app` `bun run build`(vite):通过
- 手测(desktop dev):normal 工作区跑产 landing-page.html 的 make 会话 → 设置页升级 →
  历史消息文件卡片可打开、文件树可见 output/、原 .octo 产物还在、新会话按代码工作区
  行为、studio 不受影响、重复升级 no-op(建议按此清单过一遍)

2026-10-22(目录结构改造):

- `bun test test/server/workspace-upgrade.test.ts`:9/9 通过(唯一偶发红为 afterEach
  Windows 超时,见已知限制)
- `bun test --preload ./happydom.ts ./octoapp/pages/make/utils/artifact-auto-save.test.ts`
  (packages/app):13/13 通过
- `bun run typecheck`:opencode / app / sdk 三包通过
- SDK `bun run build` 重生成:diff 仅 sdk.gen.ts 一行 description
- desktop dev 手测建议:升级后 output/ 下结构为 `<12位前缀>/<原相对路径>`;预置异内容
  同名文件再升级应报「目标已存在且内容不同」且数据零损伤;恢复历史会话卡片可打开
