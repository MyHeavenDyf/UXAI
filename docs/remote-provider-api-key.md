# 远端提供商 API Key 要求

在远端模型 JSON 的提供商层添加可选字段 `requires_api_key`，例如：

```json
{
  "content": {
    "paid-provider": {
      "id": "paid-provider",
      "name": "需要 Key 的提供商",
      "requires_api_key": true,
      "env": [],
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://example.com/v1",
      "models": {
        "example-model": {
          "id": "example-model",
          "name": "Example",
          "limit": { "context": 128000, "output": 16000 }
        }
      }
    }
  }
}
```

- 未传此字段或为 `false`：沿用现有逻辑，不新增 Key 要求。
- 为 `true` 且没有本地 Key：模型列表保留这些模型，但开关关闭、禁用；对话下拉框不显示；后端拒绝调用，包括已保存的会话选择。
- 用户在“设置 → 提供商 → 配置 API Key”填写后保存，本地认证按提供商 ID 存储，刷新提供商列表后解除限制，无须重启或重置整个项目。
- 也兼容本地提供商配置中的 `options.apiKey` 及其 `env` 指向的环境变量。登录 Token 不代替 API Key。
- 刷新远端目录不清除本地 Key。删除本地 Key 后恢复限制；如配置或环境变量仍有 Key，则仍可用。
- 填写只代表已配置，Key 是否有效、是否拥有模型权限仍由模型服务端校验。

接口提供商的 `options.requires_api_key` 和 `options.api_key_configured` 用于前端状态判断，后者由后端读取本地凭据计算；远端 JSON 不需要配置这些状态。
