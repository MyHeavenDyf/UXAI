---
name: html-prototype
description: 生成高保真交互式 HTML 原型，支持设计系统集成
---

# HTML 原型

使用 `<artifact>` 标签格式生成结构化的设计原型。

**重要提示**：所有 HTML 必须输出在 `<artifact>` 标签内。禁止使用 write、edit 或文件编辑工具。用户只能通过 artifact 预览卡片查看你的作品。

## Artifact 输出格式

```
<artifact identifier="name" type="html" title="标题">
<!DOCTYPE html>
<html>...</html>
</artifact>
```

## 支持的 Artifact 类型

- **html** — 落地页、仪表盘、Web 应用、营销页面
- **deck** — 幻灯片演示，每张幻灯片用 `<div class="slide">` 包裹
- **svg** — 图标、插画、图表
- **markdown-document** — 结构化文档
- **code-snippet** — 源代码文件

## 设计系统绑定

当设计系统处于激活状态时：
1. 原样包含 tokens.css 中的 `:root` CSS 块
2. 仅使用已定义的色板、字体比例和间距 token
3. 遵循 DESIGN.md 中的组件模式
4. 禁止用任意值覆盖设计系统的值

## 原型模式

### 落地页
- Hero 区块，清晰的价值主张
- 功能网格配图标
- CTA 行动号召区块
- 页脚

### 仪表盘
- 侧边栏导航
- 指标卡片行
- 数据表格或图表区域
- 筛选/搜索栏

### 移动应用
- 底部标签导航
- 卡片式内容布局
- 下拉刷新指示器
- 操作按钮在拇指可达范围内
