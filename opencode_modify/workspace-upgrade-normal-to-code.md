# 普通工作区原地升级为代码工作区(normal → code)

> 分支 `feat/workspace-upgrade`(自 dev_dyf 切出)。
> 动机:2026-10-19 起新建 workspace 默认 kind=code 且分类"选定不可更改"(setKind 已删),
> 存量普通工作区及其历史会话无法享受代码工作区语义(产物直接写项目内、文件面板浏览项目树)。
> 本功能提供**单向原地升级**:目录不变、历史会话留在原地,kind 翻转为 code,历史产物文件
> 从 `.octo/<sid>/outputs` **平铺复制**到 `<workspace>/output/`,并改写 DB 中 message/part
> 的路径引用;**原 `.octo/<sid>/outputs` 目录保留不删**。

## 最高原则(同 session-chat-migration)

对用户数据务求稳妥:宁可中断并明确报错,绝不造成不可逆的数据丢失。

1. **原件永不删除、目标文件绝不覆盖** —— `.octo/<sid>/outputs`(含 uploads)原样保留;
   未被改写的引用仍可经 .octo 会话式 serve 打开,天然兜底
2. **DB 只 UPDATE message/part 的 data 列** —— session 三列(directory/project_id/path)
   一律不动;kind(normal/code)是纯前端标记,服务端不感知,翻转在前端 store 做
3. **备份先行**(VACUUM INTO 整库快照),写前校验备份可读且含本次要改的行

## 迁移协议

顺序不能变:**命名规划(只读,可能新建空 output/)→ 备份+校验 → 复制 → 事务改写+自检**。

- 前两步失败还没动过任何数据(备份失败时空 output/ 由 catch 清理)
- 复制失败:原件不动、本次新建副本已清
- 改写失败:事务回滚 + 副本清理,数据保持升级前状态
- 原 .octo 产物目录全程不删

### 文件迁移

- `<ws>/.octo/<sid>/outputs/**` 递归收集(目录不存在/读不了 → 该会话无产物);
  **`.` 开头的文件与子目录一律跳过** —— `.gitkeep`(空目录占位)、`.history/**`(编辑器
  本地历史快照)是内部文件,既不计数也不迁移(与项目文件列表过滤 `.` 条目口径一致;
  实测 D:\octoAI\merge 曾因此把 2 个真产物数成 6)
- 平铺**复制**(不是移动)到 `<ws>/output/`,重命名 `<sid 前 12 位>-<原文件名>`:
  - sid 前 12 位 = `ses_` 之后的时间戳+计数器 hex 段,同毫秒创建也不重复(id.ts),
    且不随 base62 随机段变化,重跑命名稳定;形态异常的 id 兜底用整串
  - relpath 排序保证命名确定性;撞名(本次先占或盘上已有)依次 `-2`/`-3` 后缀,绝不覆盖
  - 盘上已有且内容相同(先比大小再逐字节)→ 复用不复制(重跑幂等)

### DB 路径改写

- 改写范围 = `directory === <ws>` 且 `agent ≠ 'octo_studio'` 的**全部**会话(含子会话/
  归档)的 message/part 行 —— 覆盖会话间交叉引用(子会话引用父会话产物)
- 旧路径变体(每文件 4 个):绝对/相对 × 正斜杠/反斜杠;新值统一 `<ws>/output/<最终文件名>`
  (正斜杠绝对路径,与代码工作区 link artifact 惯例一致)
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
  resolve|busy|backup|verify-backup|copy|rewrite|cleanup)/ `logWorkspaceUpgradeFailure`;
  日志前缀 `[octo:ws-upgrade]`,排查口诀:**看到 failed 就一定没动过数据**
- `src/server/routes/instance/httpapi/groups/workspace-upgrade.ts`:api group
  `/workspace-upgrade/preview|run`,错误 `ApiWorkspaceUpgradeError{stage,message}`(400)
- `src/server/routes/instance/httpapi/handlers/workspace-upgrade.ts`:守卫 + 错误映射
- `src/server/routes/instance/httpapi/api.ts` + `server.ts`:注册
- `test/server/workspace-upgrade.test.ts`:8 用例(preview 计数/studio 排除、平铺命名去重
  不覆盖、四变体改写+范围外/未映射不动、studio 原样、零产物早退、幂等重跑、备份快照、
  备份失败中止零损伤)

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
  东西,零风险);有产物或预览不可用 → 确认弹窗(说明平铺迁移/重命名/原目录保留/先备份/
  不可撤销)→ run → toast(会话数/文件数/backupPath 可自行删除)→ upgradeToCode
- i18n:`settings.workspaceUpgrade.*` 16 键(en+zh,其余 locale 缺键回退英文)

## 回滚口诀

- `[octo:ws-upgrade] failed` 出现 = 没动过数据,按 stage 修复后重跑(全流程幂等)
- 极端情况:`.ws-upgrade-bak-*` 是整库快照,用 SQLite 工具按行恢复;原件从不删除、
  从不覆盖,DB 改写只动 message/part 的 data 列

## 已知限制(v1)

- **产物文件内容不改写**:html 里的绝对自引用链接(如有)不跟着搬,只有 DB 里的引用改
- **子串替换边界**:同目录存在 `x.html` 与 `x.html.bak` 两个产物时,`x.html` 的变体是
  `x.html.bak` 引用的前缀子串,替换会把后者拼成不存在的 `output/<名>.bak`(卡片断,
  原件保留)。真实数据中产物名带后缀重叠的场景罕见,接受
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

## 验证记录

- `bun run typecheck`:opencode / sdk / app 三包通过(全仓 12/12)
- `bun test test/server/workspace-upgrade.test.ts`:8/8 通过
- `packages/app` `bun run build`(vite):通过
- 手测(desktop dev):normal 工作区跑产 landing-page.html 的 make 会话 → 设置页升级 →
  历史消息文件卡片可打开、文件树可见 output/、原 .octo 产物还在、新会话按代码工作区
  行为、studio 不受影响、重复升级 no-op(建议按此清单过一遍)
