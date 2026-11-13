# 切换工作目录后对话加载失败：sidecar OOM 诊断

日期：2026-11-12 · 分支：dev_dyf · 状态：结论已定，修复未实施（用户选择暂不修）

## 事故现象

用户（2026-11-02 报障）：使用中切换工作目录到新空目录 `D:\z60044536\新建文件夹` 后，对话列表永远加载不出来。前端控制台所有请求 ERR_CONNECTION_RESET：`/global/event`（SSE 长连）、`/session-group`、`/session`、`/experimental/session`。

## 诊断结论

### 不是数据库问题

- DB 层错误的表现是 500 + JSON error body；**全部端点同时 RST（含 SSE 长连接）= sidecar 进程整体死亡**。
- 用户 main.log 证实：V8 fatal `OOM error in V8: Zone Allocation failed - process out of memory`，sidecar exited code 4294930435。

### 崩溃时间线（用户 main.log）

1. sidecar 启动后 8.5s 堆已 381MB（远高于 dev 空载基线：全进程 WS ~112MB）
2. 112ms 内爆发 +272MB → 653MB（8550ms→8662ms 两条 GC trace 之间）
3. 时间点与 onboarding confirm（切新目录）后 app 发出的请求扇完全重合
4. `Zone Allocation failed` = native malloc 失败（**非**旧空间配额型 OOM）→ 指向进程/系统级 commit 耗尽，或单次巨型分配
5. 桌面端自动重启 sidecar → app 重连后重新拉取全部数据 → 再次 OOM → **崩溃重启循环** → 用户看到的是"对话加载不出来"

### 本地复现（dev:desktop + 直连 sidecar REST）

场景对齐用户：新建空目录、中文路径、非 git（`D:\octoAI\oom-repro\新建文件夹`，祖先链无 .git）。

- `GET /session?directory=...` 实例引导 **57ms** 完成，返回 `[]`
- 内存监控 200ms 采样 90s：WS 112→114MB，PM 184→185MB，无任何尖峰
- 结论：**新空目录的实例引导本身不是 OOM 源**。爆发分配来自用户机器上的其它数据（最可能：旧项目会话/消息在 sidecar 重启后被 app 重新物化拉取）或系统级内存压力。切目录只是时间上重合（切目录瞬间 app 发出最重的请求扇）。

代码级排除的候选（均已核查源码）：

- 文件 watcher 只 watch `ctx.directory`（空目录 trivial）与 `.git` 目录（仅 vcs=git）；不扫盘根（src/file/watcher.ts:98-141）
- `File.scan` 的 `rg.files` 以 `ctx.directory` 为 cwd，子目录级作用域；盘根有显式 guard（src/file/index.ts:355）
- 会话列表（`/session`、`/experimental/session` → `listGlobalWithCategory`）均按 directory **精确等值**过滤，global 项目的会话不会带给新目录（src/session/session-category-query.ts:130）
- 工件按 `.octo/<sessionId>/outputs` 存在目录内，空目录无内容

## 附带实锤：utilityProcess 堆上限不可控（2026-10-15 的修复是 no-op）

`packages/desktop/src/main/server.ts` 的 `execArgv: ["--max-old-space-size=2048"]`（2026-10-15 为修 sidecar OOM 加的）**无效**。实验（Electron 42.0.0 / Node 24.15.0 / Win11，utilityProcess 子进程报 `v8.getHeapStatistics().heap_size_limit`）：

| 机制 | 子进程实际堆上限 |
|---|---|
| 无（默认） | 4096MB |
| execArgv `--max-old-space-size=2048` | 4096MB（未生效；flag 只装饰性出现在 `process.execArgv`） |
| env `NODE_OPTIONS=--max-old-space-size=2048` | 4096MB（未生效） |
| env `NODE_OPTIONS=--max-old-space-size=512`（对照，若生效应显著降低） | 4096MB（未生效） |

结论：**Electron `utilityProcess.fork` 对 V8 标志既不走 execArgv 也不走 NODE_OPTIONS**。V8 默认堆上限随机器物理内存缩放——低内存机器上 utilityProcess 子进程的默认堆可能很低，sidecar 依然暴露在旧空间 OOM 风险下。即 2026-10-15 的事故（150MB 尖峰直接 OOM、exited code 5）**从未真正被修复过**。

实验脚本：仓库根 `_utility_heap_test.cjs`、`_utility_heap_mode_test.cjs`（`packages/desktop` 下直接用 electron 运行，结果写 `D:\octoAI\oom-repro\heap-mode.log`）。

## 待办（用户选择暂不实施）

1. **堆上限真正生效**：sidecar 从 `utilityProcess.fork` 改为 `child_process.spawn(process.execPath, ["--max-old-space-size=2048", sidecarJs], { env: { ELECTRON_RUN_AS_NODE: "1", ...createSidecarEnv() } })`——普通 Node 子进程会解析 V8 CLI 标志。控制协议从 parentPort postMessage 改为 stdio JSON 行（或专用 fd），崩溃检测从 `child-process-gone` 改 `exit` 事件。涉及 `packages/desktop/src/main/{server,sidecar}.ts` + 相关测试 + dev E2E。
2. **OOM 前留证据**：sidecar 周期性（如 10s）输出 heap/external/RSS 到 stderr → main.log；当前 OOM 时零上下文，只能靠 GC trace 反推。
3. **定位用户机器根因**：需完整 main.log（现有摘录从崩溃循环中段开始，第一次崩溃前 sidecar 在做什么不可见）+ 用户机器内存大小 + 运行版本（channel）。
