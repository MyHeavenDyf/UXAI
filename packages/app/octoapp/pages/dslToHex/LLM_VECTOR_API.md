# LLM 向量搜索 API 文档

本文档专为 AI/LLM 设计，提供高效的向量检索方案。

---

## 一、API 概览

**设计目标**：为 LLM 提供高效的资源检索能力，通过两步调用获取完整信息。

**两个 API 关系**：
1. `POST /api/vector/search/llm` → 精简搜索（返回 data_id + vector_text）
2. `GET /api/vector/detail` → 获取完整数据（返回所有字段）

---

## 二、精简版搜索：POST /api/vector/search/llm

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 资源类型名：`component`/`icon`/`illus`/`template`/`image` |
| `queries` | array | 是 | 搜索关键词列表（支持批量搜索） |
| `top_k` | int | 否 | 每条 query 返回结果数，默认 10 |
| `mode` | string | 否 | 搜索模式：`semantic`/`hybrid`/`keyword`，默认 `hybrid` |
| `filters` | object | 否 | 过滤条件，如 `{"category": "navigation"}` |
| `hybrid_weight` | float | 否 | 混合搜索权重（语义vs关键词），默认 0.7 |

### 返回格式

```json
{
  "results": [
    [
      {
        "data_id": "向量库唯一标识",
        "vector_text": "可搜索文本（包含资源核心信息）",
        "score": 0.95
      },
      {
        "data_id": "另一个data_id",
        "vector_text": "另一个向量文本",
        "score": 0.88
      }
    ],
    [
      // 第二个query的结果...
    ]
  ]
}
```

### 字段说明

| 字段 | 说明 | LLM 如何使用 |
|------|------|-------------|
| `data_id` | 向量库唯一标识 | 用于调用 `/detail` API 获取完整数据 |
| `vector_text` | 包含资源核心信息 | LLM **直接解析**即可识别资源，无需调用 `/detail` |
| `score` | 相似度评分（0-1） | 判断相关性，值越高越匹配 |

**关键点**：`vector_text` 已包含所有关键信息（名称、类别、属性等），LLM 可直接解析并回复用户，仅在需要详细信息（如文件路径）时才调用 `/detail`。

### 调用示例

**请求**：
```bash
curl -X POST http://localhost:8009/api/vector/search/llm \
  -H "Content-Type: application/json" \
  -d '{
    "type": "component",
    "queries": ["按钮", "输入框"],
    "top_k": 5
  }'
```

**返回**：
```json
{
  "results": [
    [
      {
        "data_id": "abc123def456",
        "vector_text": "按钮 基础类 normal 可用",
        "score": 0.95
      },
      {
        "data_id": "xyz789ghi012",
        "vector_text": "按钮 表单类 large 禁用 不可用",
        "score": 0.92
      }
    ],
    [
      {
        "data_id": "mno345pqr678",
        "vector_text": "输入框 表单类 medium 正常 启用",
        "score": 0.88
      }
    ]
  ]
}
```

---

## 三、全量数据获取：GET /api/vector/detail

### 请求参数（Query 参数）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 资源类型：`component`/`icon`/`illus`/`template`/`image` |
| `data_id` | string | 是 | 从 `/search/llm` 返回的 `data_id` |

### 返回格式

返回完整字段（30+ 字段），关键字段如下：

**通用字段**（所有类型）：
| 字段 | 说明 |
|------|------|
| `id` | 资源表 ID |
| `resource_type` | 类型 ID（1-5） |
| `name` | 资源名称 |
| `description` | 描述文本 |
| `file_name` | 文件名 |
| `file_path` | 文件路径 |
| `file_size` | 文件大小 |
| `mime_type` | 文件类型 |
| `thumbnail_path` | 缩略图路径 |
| `tags` | 标签列表 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

**组件专用字段**（type=component）：
| 字段 | 说明 |
|------|------|
| `cv_component_name` | 组件集名称 |
| `cv_canvas_name` | 组件类别 |
| `cv_variant_name` | 变体属性 |
| `cv_component_key` | 组件 Key |
| `cv_variant_key` | 变体 Key |

**图标专用字段**（type=icon）：
| 字段 | 说明 |
|------|------|
| `icon_id` | 图标原始 ID |
| `icon_english_name` | 英文短名 |
| `icon_chinese_name` | 中文名 |
| `icon_category` | 分类 |

**插画专用字段**（type=illus）：
| 字段 | 说明 |
|------|------|
| `illus_id` | 插画原始 ID |
| `illus_category` | 分类 |
| `illus_tags` | 标签列表 |
| `illus_version` | 版本号 |

### 调用示例

**请求**：
```bash
curl -X GET "http://localhost:8009/api/vector/detail?type=component&data_id=abc123def456"
```

**返回**：
```json
{
  "id": 123,
  "resource_type": 1,
  "name": "按钮",
  "description": "基础按钮组件",
  "file_path": "component/buttons/",
  "cv_component_name": "按钮",
  "cv_canvas_name": "1.基础类",
  "cv_variant_name": "size=normal, disabled=false",
  "cv_variant_key": "abc123def456",
  "tags": ["基础", "表单"],
  "created_at": "2024-01-01T10:00:00",
  ...
}
```

---

## 四、典型使用流程

### 流程步骤

```
步骤1: 用户提出需求 → LLM 提取关键词
步骤2: LLM 调用 POST /api/vector/search/llm
步骤3: LLM 解析 vector_text，识别相关资源
步骤4: （可选）LLM 调用 GET /api/vector/detail 获取完整信息
步骤5: LLM 返回结果给用户
```

### 完整示例场景

**用户需求**："帮我找一个可用的按钮组件"

**LLM 执行流程**：

#### 步骤1：提取关键词
LLM 分析用户需求，提取关键词：`["按钮", "可用", "正常"]`

#### 步骤2：调用精简搜索
```bash
POST /api/vector/search/llm
{
  "type": "component",
  "queries": ["按钮 可用 正常"],
  "top_k": 3
}
```

#### 步骤3：解析 vector_text
LLM 收到返回：
```json
{
  "results": [
    [
      {
        "data_id": "abc123",
        "vector_text": "按钮 基础类 normal 可用",
        "score": 0.95
      },
      {
        "data_id": "def456",
        "vector_text": "按钮 表单类 small 禁用 不可用",
        "score": 0.75
      }
    ]
  ]
}
```

LLM 解析：
- 第1条：`"按钮 基础类 normal 可用"` → 匹配需求（可用）
- 第2条：`"按钮 表单类 small 禁用"` → 不匹配（禁用）

#### 步骤4：（可选）获取完整信息
LLM 如需文件路径等信息，调用：
```bash
GET /api/vector/detail?type=component&data_id=abc123
```

#### 步骤5：返回结果
LLM 告知用户：
"找到了一个可用的按钮组件：基础类按钮，属性为 normal（正常），可立即使用。"

---

## 五、资源类型与 data_id 映射

**关键表格**：

| 资源类型 | `type` 参数 | `data_id` 来源 | `data_id` 格式示例 |
|---------|------------|---------------|------------------|
| 组件集 | `component` | `ComponentVariant.variant_key` | `abc123def456...`（长hash） |
| SVG图标 | `icon` | `ResourceIcon.icon_id` | `100`（数字） |
| 插画 | `illus` | `ResourceIllus.illus_id` | `EMPLY_ILL`（字符串） |
| 模版 | `template` | `Resource.id` | `123`（数字） |
| 图片 | `image` | `Resource.id` | `456`（数字） |

**注意**：
- `data_id` 与 `type` 必须配套使用
- 不同类型的 `data_id` 来源不同，格式也不同

---

## 六、vector_text 内容说明

**vector_text 已包含所有核心信息**，LLM 可直接解析：

| 资源类型 | vector_text 内容 | 示例 |
|---------|----------------|------|
| 组件 | `组件名 类别 属性值 中文翻译` | `"按钮 基础类 normal 可用 正常 启用"` |
| 图标 | `分类 中文名 英文全称 英文短名 描述` | `"navigation 首页 it home 房子图标"` |
| 插画 | `插画ID 别名 描述 分类 标签 版本` | `"EMPLY_ILL 空状态 描述 领域A 标签 2.0"` |
| 模版 | `名称 描述` | `"登录页面模版 适用于移动端"` |
| 图片 | `名称 描述` | `"产品截图.jpg 首页展示图"` |

**解析建议**：
- 组件：提取"组件名"和"属性值"
- 图标：提取"分类"和"中文名/英文名"
- 插画：提取"别名"和"分类"
- 模版/图片：提取"名称"

---

## 七、注意事项

1. **优先解析 vector_text**：包含所有关键信息，无需立即调用 `/detail`
2. **批量搜索支持**：`queries` 数组可同时搜索多个关键词，结果顺序与 `queries` 一一对应
3. **score 判断相关性**：值越高越匹配，通常 > 0.8 为高度相关
4. **filters 精确过滤**：如需特定分类，可用 `{"category": "navigation"}`
5. **data_id 唯一性**：同一资源在不同搜索中 `data_id` 相同
6. **type 参数必填**：必须明确资源类型，否则无法查询

---

## 八、常见错误

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `"不支持的 type：xxx"` | type 参数错误 | 使用正确的类型名：component/icon/illus/template/image |
| `"queries 不能为空"` | queries 参数缺失 | 添加搜索关键词数组 |
| `"资源不存在或已删除"` | data_id 错误或资源已删除 | 检查 data_id 是否正确 |
| `"向量服务调用失败"` | 向量服务未启动 | 等待服务启动或联系管理员 |

---

## 九、API 地址

**开发环境**：
- `http://localhost:8009/api/vector/search/llm`
- `http://localhost:8009/api/vector/detail`

**生产环境**：
- 替换 `localhost:8009` 为实际服务地址

---

## 十、组件搜索结果 → 设计 DSL instance 节点

搜索到组件后，调用 `/api/vector/detail` 获取完整数据，再将字段映射到设计 DSL 的 `instance` 节点。

### 字段映射表

| DSL 字段 | `/detail` 返回字段 | 说明 |
|---------|------------------|------|
| `instance.variant_key` | `cv_variant_key` | 变体唯一 key |
| `instance.component_set_key` | `cv_component_key` | 组件集 key（即 parentKey）|
| `instance.symbol_id` | `cv_variant_guid` | 变体 GUID，格式 `"sessionID:localID"` |
| `instance.path` | `cv_lib_file_key` + `"/"` + `file_path` | 拼接得到 hex 文件路径，如 `"mock-key-001/component/be1d....txt"` |
| `instance.variant_props` | `cv_variant_name` 解析 | 将 `"size=normal, disabled=false"` 解析为 `{"size":"normal","disabled":"false"}` |
| `instance.component_set_resolved` | 固定 `true` | 本地库已成功解析 |
| `instance.overrides` | 固定 `[]` | 无覆写 |

### 完整转换示例

**Step 1：搜索组件**
```bash
POST /api/vector/search/llm
{
  "type": "component",
  "queries": ["按钮 正常 可用"],
  "top_k": 1
}
```

返回：
```json
{
  "results": [[
    { "data_id": "f884abc...", "vector_text": "按钮 基础类 normal 可用 正常", "score": 0.95 }
  ]]
}
```

**Step 2：获取完整数据**
```bash
GET /api/vector/detail?type=component&data_id=f884abc...
```

返回：
```json
{
  "cv_variant_key":    "f884abc...",
  "cv_component_key":  "be1dabc...",
  "cv_variant_guid":   "8229:277395",
  "cv_lib_file_key":  "mock-key-001",
  "cv_lib_name":      "AAA组件库",
  "cv_variant_name":   "size=normal, disabled=false",
  "file_path":         "component/be1dabc....txt",
  ...
}
```

**Step 3：构造 DSL instance 节点**

```python
detail = response_from_detail_api

# 解析 variant_props
variant_props = {}
for pair in detail["cv_variant_name"].split(","):
    pair = pair.strip()
    if "=" in pair:
        k, v = pair.split("=", 1)
        variant_props[k.strip()] = v.strip()

dsl_layer = {
    "type": "instance",
    "name": detail["cv_component_name"],
    "box":  { "x": 0, "y": 0, "width": 0, "height": 0 },  # 由调用方按实际位置填写
    "instance": {
        "symbol_id":              detail["cv_variant_guid"],
        "variant_key":            detail["cv_variant_key"],
        "component_set_key":      detail["cv_component_key"],
        "component_set_resolved": True,
        "path":                   f"{detail['cv_lib_file_key']}/{detail['file_path']}",
        "variant_props":          variant_props,
        "overrides":              []
    }
}
```

**最终输出的 DSL 片段**：
```json
{
  "type": "instance",
  "name": "按钮",
  "box": { "x": 0, "y": 0, "width": 120, "height": 36 },
  "instance": {
    "symbol_id":              "8229:277395",
    "variant_key":            "f884abc...",
    "component_set_key":      "be1dabc...",
    "component_set_resolved": true,
    "path":                   "ICT_UI/component/be1dabc....txt",
    "variant_props":          { "size": "normal", "disabled": "false" },
    "overrides":              []
  }
}
```

---

### 修改组件文字（variant_props）

组件显示的文字内容**只能通过 `variant_props` 修改**，且只有 `type == "TEXT"` 的属性才能承载文字。

`/detail` 返回的 `cv_component_props` 字段记录了该变体的所有属性（名称 + 类型），例如：

```json
{
  "cv_component_props": [
    { "name": "text",     "type": "TEXT"     },
    { "name": "icon",     "type": "INSTANCE" },
    { "name": "disabled", "type": "BOOLEAN"  }
  ]
}
```

**Step 1：从 `cv_component_props` 中筛选 TEXT 属性**

```python
detail = response_from_detail_api

text_props = [
    prop for prop in detail.get("cv_component_props", [])
    if prop.get("type") == "TEXT"
]
# text_props → [{"name": "text", "type": "TEXT"}]
```

**Step 2：将目标文字追加到 `variant_props`**

```python
new_label = "立即购买"   # 由调用方按实际需求填写

for prop in text_props:
    variant_props[prop["name"]] = new_label
# variant_props → {"size": "normal", "disabled": "false", "text": "立即购买"}

dsl_layer["instance"]["variant_props"] = variant_props
```

**最终输出的 DSL 片段**：

```json
{
  "type": "instance",
  "name": "按钮",
  "box": { "x": 0, "y": 0, "width": 120, "height": 36 },
  "instance": {
    "symbol_id":              "8229:277395",
    "variant_key":            "f884abc...",
    "component_set_key":      "be1dabc...",
    "component_set_resolved": true,
    "path":                   "ICT_UI/component/be1dabc....txt",
    "variant_props":          { "size": "normal", "disabled": "false", "text": "立即购买" },
    "overrides":              []
  }
}