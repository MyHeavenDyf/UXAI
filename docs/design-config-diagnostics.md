# 配置接口诊断日志

桌面端将 `[octo:config]` 日志写入 `main.log` 同目录的 `design.log`。
保留现有 5MB 滚动和 7 天清理机制，不改变配置接口的返回内容或状态码。

## 收集方式

1. 使用包含本次改动的客户端复现一次。
2. 在原 `main.log` 所在目录找到 `design.log`。
3. 确认新记录有 `diagnosticVersion: 2`；旧版日志没有这套完整诊断。
4. 提供同一 `requestID` 的记录；发生重试时每次请求会有独立编号。

## 请求阶段

| stage | 含义 |
| --- | --- |
| request | 请求已进入应用路由，含请求目录、服务端版本、系统及运行时版本 |
| read:start | 已进入配置读取逻辑，含实际解析后的目录 |
| read:success | 配置服务已返回数据，不代表响应编码已经成功 |
| read:failed | 配置读取失败，含脱敏错误和配置源文件位置（错误携带时） |
| response | 返回的 HTTP 状态码 |
| request:failed | 最终失败诊断，含处理阶段、原始错误摘要和失败时的配置复核 |

`readStage: not-started` 表示失败发生在读取处理函数之前，可能是实例初始化、路由或认证等环节。
配置也可能在实例初始化时加载；此时要结合 `errors`，不能仅凭阶段认定未读取任何配置文件。

## 失败诊断

- `errors[].kind: Body`：HTTP 响应编码或校验失败，不代表目录参数校验失败。
- `issues[].path`：失败字段位置。
- `expected` / `expectedKinds`：预期的类型或联合类型成员类别，不输出枚举字面值。
- `actualType`：实际值的类型，不输出实际值。
- `diagnostics.wrappers`：内部错误包装的类型、层级和字段名，兼容不同错误结构。
- `diagnostics.extraction: no-structured-issues`：原错误未能提供可识别的结构化字段；不是“没有错误”。
- `diagnostics.truncated` / `limits`：诊断被安全上限截断时明确记录原因，不静默丢弃。
- `configProbe.schema`：仅在请求失败且已捕获配置时，用配置接口的规范定义独立复核。
- `configProbe.schema.status: not-run`：结构扫描发现访问器、自定义转换或超过工作上限，为避免执行配置中的代码而跳过复核。
- `configProbe.json`：用有界结构检查定位 BigInt、循环引用等序列化风险；不执行自定义 `toJSON`，不为此读取 getter。
- `configProbe.json.status: indeterminate`：存在自定义转换、访问器或扫描上限，不能安全确认序列化结果。
- `configProbe.status: not-read`：尚未捕获返回配置，不能执行复核。

配置复核仅在失败时执行；成功请求不重复执行完整配置校验。
日志不打印完整配置、实际字段值、错误原文、请求头或完整请求 URL，避免泄露 token、Cookie 等凭据。
字段路径和本地目录仍可能包含用户名或内部项目名称，外发日志前应按需要脱敏。
