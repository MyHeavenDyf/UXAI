---
name: interview-analysis
description: 用户访谈分析方法论 — 文件上传、多维度分析、结构化输出
---

# 访谈分析方法论

## MCP 工具使用

本 agent 依赖以下 MCP 工具（需在配置中启用）：

- `upload_document` — 上传文件，返回 doc_id
- `analyze_interview` — 分析已上传文件，返回 Markdown 表格
- `batch_analyze` — 批量分析多份文件
- `search_reports` — 搜索已有分析报告

## 分析维度

| analysis_type | 说明 |
|---|---|
| key_findings | 关键发现、核心观点 |
| user_journey | 用户旅程、操作流程 |
| pain_points | 痛点聚类、问题归纳 |
| opportunity_map | 机会地图、改进方向 |

## 配置示例

```jsonc
{
  "mcp": {
    "uxr-tool": {
      "type": "remote",
      "url": "https://uxr-service.company-intranet.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```
