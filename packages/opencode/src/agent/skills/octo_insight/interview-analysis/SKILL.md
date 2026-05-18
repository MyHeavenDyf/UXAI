---
name: interview-analysis
description: 用户访谈分析方法论 — 多维度分析、结构化输出
---

# 访谈分析方法论

## MCP 工具使用

本 agent 依赖以下 MCP 工具（需在配置中启用）：

- `analyze_interview` — 分析已上传文件，返回 Markdown 表格或 JSON
- `search_reports` — 搜索已有分析报告（知识问答，无需上传文件）

## 分析维度

| analysis_type | 说明 |
|---|---|
| key_findings | 关键发现、核心观点 |
| cluster_by_outline | 按提纲聚类、按大纲整理 |
| generate_persona | AI 用户画像生成 |
| evaluation_summary | 评估问题整理、评测打分 |
| mindmap | 思维导图（返回 JSON，客户端渲染） |

## 配置示例

```jsonc
{
  "mcp": {
    "uxr-tool": {
      "type": "remote",
      "url": "http://7.192.161.60:8005/mcp",
      "timeout": 30000
    }
  }
}
```
