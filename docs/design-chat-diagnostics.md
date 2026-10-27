# 模型不回复：design.log 诊断

安装包含本次改动的客户端后，发送一条消息复现。打开 `main.log` 同目录的 `design.log`，查找 `[octo:chat]`，提供从发送前到失败或等待结束这一整段日志。

`sessionID` 关联会话，`messageID` 关联回复，`requestID` 关联某一层的一次请求；重试、标题生成等可能产生多次模型请求。`small: true` 表示辅助模型请求，不要误认为聊天正文请求。

| 阶段                                                            | 用于判断                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| prompt 层 start / prompt:user-saved                             | 后端是否收到发送操作、是否保存用户消息；noReply 表示调用方要求不回复                       |
| loop:step / loop:request-prepared                               | 是否进入对话循环并准备好模型输入                                                           |
| processor:start / processor:preflight                           | 是否因上下文超限在请求前拒绝或触发压缩                                                     |
| llm:prepare / llm:model-ready / llm:\*plugin                    | 是否卡在模型、配置、认证、插件准备阶段                                                     |
| llm:stream-start / http:request                                 | SDK 是否开始调用接口、是否真正发起 HTTP 请求                                               |
| http:response                                                   | 接口状态码、响应类型，authHeaders 只列凭据头名称，不含值                                   |
| http:first-byte / http:body-end                                 | 是否收到响应体、流是否结束，含字节计数                                                     |
| stream:first-event / stream:first-text / stream:first-reasoning | SDK 是否解析出事件、正文或仅思考内容                                                       |
| processor:retry / processor:failed                              | 是否重试或失败，错误仅记录分类、名称、状态码和网络错误码                                   |
| processor:text-saved / processor:message-saved                  | 正文及最终消息是否保存；已保存但界面没显示需再排查前端                                     |
| end                                                             | 请求结束，区分 empty-output、reasoning-only、tool-only、text-received、failed、interrupted |

请求未结束时每 30 秒写入 `waiting-or-progress`，包含耗时、最后阶段、无活动时长和累计计数；这只是观测，不会自动超时、重试或取消请求。收到正文也不代表整轮成功，需结合后续失败和保存记录判断。

性能：不逐 token 写日志，不重复读取响应体；复用已有流观察分支，只增加计数与关键节点。请求结束或取消后清理定时器。沿用 `design.log` 的 5MB 滚动与 7 天清理规则。

不记录聊天正文、思考正文、工具参数、响应原文、token、Cookie 或 URL 查询参数。日志仍含模型标识和接口域名，外发前按需要脱敏。配置诊断 `[octo:config]` 继续保留在同一文件。
