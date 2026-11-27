# Studio 首次进入卡顿：测试包后端计时

需要重新构建并安装包含本次计时改动的桌面测试包。现有安装包不能通过 Console 脚本补上这些后端分段。

## 测试操作

1. 启动测试包，在 Design 模块打开 DevTools → Network，勾选 Preserve log。
2. 按平时的操作首次进入 Studio，侧栏保持正常使用状态。
3. 分别采集两种情况。每种情况由测试人员重新启动应用后单独操作，避免前一次已经完成初始化：
   - 不点击 AI 推荐，直接打开历史会话，观察文字和卡片是否延迟。
   - 在空白首页点击 AI 推荐，等待示例短语出现。
4. 选中对应的慢请求：`GET /session/:id/message` 或 `POST /studio/prompt-recommendations`。
5. 复制 Response Headers 中的 `Server-Timing` 和 `X-Studio-Timing-Id`，同时记下 Network → Timing 中的 Waiting for server response 耗时。无需粘贴 Console 脚本。

## 如何读计时

`Server-Timing` 中的阶段表示从上一个标记到当前标记的毫秒数。`total` 是后端 HTTP 中间件接到请求到生成响应的总耗时。`event_loop_lag` 是请求期间采样到的最大事件循环延迟，属于辅助指标，不与各阶段相加。

| 阶段 | 覆盖范围 |
| --- | --- |
| `instance_loading` | 请求进入后，到开始准备目录实例之前，包括前置路由和鉴权 |
| `instance_ready` | 等待目录实例准备完成 |
| `recommendation_handler` | 实例就绪到推荐适配器进入，包括 Web Request 转换 |
| `body_read` | 推荐请求体读取、解析和检查 |
| `input_checked` | 推荐参数验证、标识计算；已有会话还包括状态检查 |
| `submission_state_ready` | 推荐提交状态的首次初始化或读取 |
| `transaction_entered` | 开始数据库事务前到进入事务回调，包括获取事务所需的等待 |
| `session_written` | 幂等检查及会话创建，或已有会话检查 |
| `messages_written` | 空会话检查及示例消息写入 |
| `guide_written` | 推荐引导消息 part 写入 |
| `snapshot_ready` | 返回状态快照构造 |
| `transaction_finished` | 事务提交和提交后的同步事件回调；幂等重放分支会跳过写入标记 |
| `json_encoded` | 推荐响应 JSON 编码 |
| `messages_handler` | 实例就绪到消息读取处理器进入 |
| `session_checked` | 会话存在性检查 |
| `messages_read` | 消息及 parts 读取和组装 |
| `response_ready` | 上一个标记到响应生成完成；消息接口包含输出 schema/JSON 编码等处理 |

- `instance_ready` 大：检查实例首次启动及并发等待。
- `submission_state_ready` 大：检查推荐状态运行时初始化。
- `transaction_entered` 或写入/提交阶段大：检查数据库等待、同步操作及事件回调，不能仅凭接近 5 秒就断定锁超时。
- `messages_read` 大：检查消息量、parts 数据量、查询和组装成本。
- `response_ready` 大而 `messages_read` 小：检查响应编码等读取后的处理。
- `event_loop_lag` 同时明显变大：说明存在后端调度延迟，可能是同步执行阻塞、CPU 竞争或进程调度问题；该指标本身不能认定具体 SQL 是根因。
- Network 等待几秒、后端 `total` 却很小：慢点可能在中间件开始执行前，或响应生成之后；继续查连接、请求排队和进程调度。`total` 不包含尚未进入 JavaScript HTTP 中间件的时间，也不包含完整网络发送时间。

## 后端详细日志

同一次请求会产生一行 `service=studio.request-timing` 的 `complete` 日志，其中 `entry` JSON 包含：请求编号、服务端接收时间、方法、路径、状态、总耗时、各阶段累计/分段耗时和最大事件循环延迟。

在后端日志中搜索响应头 `X-Studio-Timing-Id` 对应的编号即可关联。日志使用现有后端日志目录：默认 Windows 为 `%USERPROFILE%\.local\share\opencode\log`；若使用 `XDG_DATA_HOME` 则为该目录下的 `opencode\log`；桌面存储回退模式为应用 userData 下的 `opencode\log`。

临时诊断覆盖推荐创建、会话消息 GET 和健康检查，自动启用；不记录请求正文、对话内容、请求头、查询字符串或工作目录。完成定位后可以移除本次计时代码。
