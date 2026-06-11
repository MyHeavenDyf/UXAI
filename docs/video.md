# 视频创建（Video Create）组件完整功能文档

## 概述

视频创建组件包含4个核心文件，采用三层架构设计：

- **FusionVideoCreatePage.vue** — 页面级容器，管理风险控制弹窗、侧边面板（历史选择）、以及子组件调度
- **FusionVideoCreate.vue** — 页面容器，提供Tab切换（文生视频/图生视频），路由子组件
- **FusionVideoCreateText.vue** — **文生视频**模式的具体实现
- **FusionVideoCreateImg.vue** — **图生视频**模式的具体实现（首尾帧/多图参考）

```
FusionVideoCreatePage (页面级容器)
  └── FusionVideoCreate (Tab路由容器)
        ├── FusionVideoCreateText (文生视频)
        └── FusionVideoCreateImg (图生视频)
```

---

## 一、FusionVideoCreatePage.vue — 页面级容器

### 1.1 组件层级结构

```
FusionVideoCreatePage-container
├── Teleport to="body"
│   └── FusionCreate-modal-overlay (风险控制遮罩层)
├── FusionVideoCreate-tip (风险控制弹窗)
│   └── FusionRiskControl
└── FusionVideoCreate-content (主内容区)
    ├── FusionVideoCreate (视频创建主组件)
    └── Transition FusionVideoCreate-extra-panel (侧边弹出面板)
        └── FusionHistorySelect (历史选择面板)
```

### 1.2 核心数据状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `isCheckKlingTip` | ref\<boolean\> | 用户是否已确认过风险提示（同意后不再显示） |
| `showKlingCheck` | ref\<boolean\> | 是否显示风险控制弹窗 |
| `showModal` | ref\<boolean\> | 是否显示侧边面板 |
| `showExtraPanelName` | ref\<string\> | 当前侧边面板名称（目前仅 'historySelect'） |
| `maxSelect` | ref\<number\> | 历史选择允许的最大数量 |

### 1.3 核心方法

#### 风险控制流程

**`checkKlingCheckTip()`** — 检查是否需要显示风险提示
1. 如果用户未同意过（`!isCheckKlingTip`），打开风险控制弹窗
2. 暴露给父组件，在进入视频创建页面时调用

**`openKlingCheck()`** — 打开风险控制弹窗
- 设置 `showKlingCheck = true`

**`closeKlingCheck()`** — 关闭弹窗（点击关闭按钮）
1. 记录埋点：操作=关闭、时间
2. 隐藏弹窗，跳转到"创意生成"页面

**`cancelTip()`** — 取消（点击取消按钮）
1. 记录埋点：操作=取消、时间
2. 隐藏弹窗，跳转到"创意生成"页面

**`confirmTip()`** — 确认同意（点击确认按钮）
1. 记录埋点：操作=同意、时间
2. 设置 `isCheckKlingTip = true`（标记已同意，不再弹出）
3. 隐藏弹窗

#### 面板控制

**`openExtraPanel(val)`** — 打开侧边面板
1. 获取当前图片生成类型 `getImgCreateType()`
2. 根据类型设置 `maxSelect`：
   - `twiceImg`（首尾帧）：最多选择 2 张
   - 其他（多图参考）：最多选择 4 张
3. 显示面板，跳转面板名称
4. 调用 `changeScreen()`

**`closeExtraPanel()`** — 关闭侧边面板
1. 隐藏面板，清空名称
2. 调用 `changeScreen()`

**`changeScreen()`** — 通知父组件屏幕变化
- 调用 `fusionHomeFunc.changeScreen(srceenType)`，srceenType 为面板名称或 'simplate'

### 1.4 中转方法

| 方法 | 说明 |
|------|------|
| `sendHistorySelect(list)` | 将历史选择的图片列表转发给子组件 |
| `appCreateParam(val)` | 外部传入参数，转发给子组件 |
| `quickToVideo(val)` | 快速转视频，转发给子组件 |
| `sendImgToVideo(obj)` | 传图视频，转发给子组件 |

### 1.5 Provide/Inject

```javascript
provide('fusionCreatePageFunc', {
  openExtraPanel,    // 打开历史选择面板
  closeExtraPanel,   // 关闭历史选择面板
})
```

### 1.6 对外暴露

```javascript
defineExpose({
  checkKlingCheckTip,  // 检查风险提示
  showExtraPanelName,  // 当前面板名称
  showModal,           // 面板可见性
  appCreateParam,      // 外部API参数注入
  quickToVideo,        // 快速转视频
  sendImgToVideo,      // 传图到视频
})
```

---

## 二、FusionVideoCreate.vue — Tab路由容器

### 2.1 组件层级结构

```
FusionVideoCreate-container
├── oTab (Tab切换栏)
│   ├── 文生视频 (textCreate)
│   └── 图生视频 (imgCreate)
├── FusionVideoCreateText (v-show="activeName === 'textCreate'")
└── FusionVideoCreateImg (v-show="activeName === 'imgCreate'")
```

### 2.2 核心数据状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `tabList` | Array | Tab配置: `[{ label: '文生视频', value: 'textCreate' }, { label: '图生视频', value: 'imgCreate' }]` |
| `activeName` | ref\<string\> | 当前激活的Tab，默认 `'textCreate'` |

### 2.3 核心方法

**`tabChange(val)`** — Tab切换
- 如果点击的Tab与当前相同，不处理
- 否则切换到新Tab

**`sendHistorySelect(list)`** — 转发历史选择到图生视频子组件

**`appCreateParam(val)`** — 外部参数注入
- `t2v_kl` 或 `t2v_seedance` → 切换到文生视频Tab
- 其他 → 切换到图生视频Tab
- 然后将参数转发到对应子组件

**`getImgCreateType()`** — 获取当前图片生成类型
- 转发到图生视频子组件的 `createType`

**`quickToVideo(val)`** — 快速转视频
- 切换到图生视频Tab，转发参数

**`sendImgToVideo(obj)`** — 传图到视频
- 如果当前是文生视频Tab → 提示用户"当前生成模式暂不支持上传参考图"
- 如果是图生视频Tab → 转发到子组件

### 2.4 对外暴露

```javascript
defineExpose({
  getImgCreateType,
  sendHistorySelect,
  appCreateParam,
  quickToVideo,
  sendImgToVideo,
})
```

---

## 三、FusionVideoCreateText.vue — 文生视频

### 3.1 组件层级结构

```
FusionVideoCreateText-container
├── create-title "创意描述"
├── create-prompt-box (Prompt输入区)
│   ├── el-input type="textarea" (maxlength=1000)
│   ├── create-prompt-bottom (底部操作栏)
│   │   └── prompt-bottom-btn (随机示例按钮)
│   └── create-prompt-placeholder (占位提示文字，含"使用指南"链接)
│
├── video-create-config (参数配置行1)
│   ├── video-size-config (比例选择)
│   │   ├── video-create-select (下拉触发器)
│   │   └── FusionSize (下拉面板)
│   ├── video-length-config (时长选择)
│   │   ├── video-create-select (下拉触发器)
│   │   └── select-video-config-content (下拉面板: 5S / 10S)
│   └── video-count-config (数量选择)
│       ├── video-create-select (下拉触发器)
│       └── FusionCountSelect (下拉面板)
│
├── video-create-config (参数配置行2)
│   └── video-mode-config (模式选择)
│       ├── video-create-select (下拉触发器)
│       └── select-video-config-content (下拉面板: 标准模式 / 高质量模式)
│
└── create-bottom (底部)
    ├── create-bottom-declare (声明文字，含链接)
    └── create-bottom-btn-box
        └── oButton "一键生成" (:disabled="createDisable")
```

### 3.2 核心数据状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `prompt` | ref\<string\> | 用户输入的提示词 |
| `createVideoSize` | reactive | 画面比例: `{ label: '1:1' }` |
| `createVideoLength` | reactive | 视频时长: `{ label: '5S', value: '5' }` |
| `createCount` | ref\<number\> | 生成数量，默认 1 |
| `createVideoMode` | reactive | 生成模式: `{ label: '标准模式', value: 'std' }` |
| `loadingToastId` | ref | 加载中Toast ID |

### 3.3 下拉面板配置

| 配置项 | 选项 | 组件 |
|--------|------|------|
| 比例 | 各种比例（由 FusionSize 组件提供） | FusionSize（sizeType="kling"） |
| 时长 | 5S, 10S | 自定义列表 |
| 数量 | 1-4（由 FusionCountSelect 组件提供） | FusionCountSelect（countType="kling"） |
| 模式 | 标准模式 (std), 高质量模式 (pro) | 自定义列表 |

### 3.4 核心方法

**`enterPromptExample()`** — 填入随机示例Prompt
1. 循环从 `videoCreateTextExampleConfig` 数组中取示例
2. 填入 prompt 和比例等参数
3. 达到数组长度后从头循环

**`startCreate()`** — 一键生成（核心API调用）
1. **前置检查**：如果 prompt 为空，提示"请撰写提示词"并返回
2. **组装参数**：
```json
{
  "user": { "idx": "[user_id]" },
  "task_type": "t2v_seedance",
  "args": {
    "tag_name": "文生视频",
    "prompt": "用户输入的提示词",
    "aspect_ratio": "1:1",
    "duration": "5",
    "count": 1,
    "mode": "std"
  }
}
```
3. **发起请求**：显示加载Toast → `buildCreateTask(paramData)`
4. **错误处理**：
   - `5004`: "最多支持同时进行 3 个生成任务"
   - `5008`: "提示词包含敏感内容"
   - `5009`: 返回服务端自定义错误消息
   - `error` / 无result: "生成失败，请检查网络"
5. **成功处理**：调用 `createVideoUEM()` 发送埋点 → 刷新历史列表

**`createVideoUEM(param)`** — 埋点上报
```javascript
window.hwa("trackStructEvent", {
  uem_id: 'P6727F86A44DD4_C10631762A8CA4C0',
  uem_label: '一键生成',
  data: {
    user_id,
    type: '文生视频',
    prompt,
    ratio,
    duration,
    count,
    mode
  }
})
```

**`appCreateParam(val)`** — 外部参数填充
- 将 `val.args` 中的 prompt、aspect_ratio、duration、count、mode 填充到对应响应式变量

### 3.5 计算属性

**`createDisable`** — 按钮禁用条件
- `!prompt.value`（提示词为空时禁用）

### 3.6 对外暴露

```javascript
defineExpose({ appCreateParam })
```

### 3.7 关键技术细节

- 下拉面板使用 `v-click-outside` 指令实现点击外部关闭
- 下拉箭头使用 CSS transition 实现180度旋转动画
- 所有下拉面板使用 `Transition name="FusionCreate-dropDown"` 实现弹出动画
- Prompt 输入框使用 `el-input type="textarea"` + 自定义占位符覆盖（非 `placeholder` 属性，而是独立的 div 实现富文本占位符，内含可点击链接）
- 底部声明文字包含3条声明，内含两个外部链接（管理指引 + Seedance服务条款）

---

## 四、FusionVideoCreateImg.vue — 图生视频

### 4.1 组件层级结构

```
FusionVideoCreateImg-container
├── video-create-type-config (生成类型切换)
│   ├── video-create-type-btn "首尾帧" (twiceImg)
│   └── video-create-type-btn "多图参考" (moreImg) [含信息提示图标]
│
├── create-upload-img-box (图片上传区)
│   ├── twiceImg-upload-box (首尾帧模式 - v-if)
│   │   ├── twiceImg-upload-box-item (当前活跃的上传位)
│   │   │   ├── twiceImg-upload-text-box (空状态 - 点击上传)
│   │   │   ├── twiceImg-upload-loading-box (加载中)
│   │   │   └── twiceImg-upload-after-box (已上传 - 含删除按钮)
│   │   └── twiceImg-upload-btn-box (切换首帧/尾帧)
│   │       ├── twiceImg-upload-btn "首帧图"
│   │       ├── twiceImg-upload-change-btn (交换按钮)
│   │       └── twiceImg-upload-btn "尾帧图"
│   │
│   └── moreImg-upload-box (多图参考模式 - v-if)
│       ├── moreImg-upload-item × 4 (4个上传位)
│       │   ├── moreImg-upload-text-box (空状态)
│       │   ├── moreImg-upload-loading-box (加载中)
│       │   └── moreImg-upload-after-box (已上传 - 含删除按钮)
│
├── create-title "创意描述"
├── create-prompt-box (Prompt输入区，同文生视频)
│
├── video-create-config (参数配置行1：比例/时长/数量)
├── video-create-config (参数配置行2：模式，含禁用逻辑)
│
└── create-bottom (底部，同文生视频)
```

### 4.2 核心数据状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `createType` | ref\<string\> | 生成类型: `'twiceImg'` / `'moreImg'` |
| `twiceImgType` | ref\<number\> | 当前上传位: 0=首帧, 1=尾帧 |
| `twiceImgList` | ref\<array\> | 首尾帧图片列表: `[{ imgLoading, imgUint8, imgBase64 }, ...]` (长度2) |
| `moreImgList` | ref\<array\> | 多图参考图片列表: `[{ imgLoading, imgUint8, imgBase64 }, ...]` (长度4) |
| `createVideoModeDisabled` | ref\<boolean\> | 模式选择是否禁用 |
| `prompt` | ref\<string\> | 提示词 |
| `createVideoSize` | reactive | 画面比例 |
| `createVideoLength` | reactive | 视频时长 |
| `createCount` | ref\<number\> | 生成数量 |
| `createVideoMode` | reactive | 生成模式 |

### 4.3 生成类型切换

**`videoCreateTypeConfig`**：
```javascript
[
  { label: '首尾帧', value: 'twiceImg' },
  { label: '多图参考', value: 'moreImg' },
]
```

**`changeCreateType(val)`** — 切换生成类型
- 关闭侧边面板

### 4.4 图片上传体系

#### 首尾帧模式 (twiceImg)

**结构说明**：
- 2个图片位：索引0（首帧图）、索引1（尾帧图）
- 同一时间只有一个图片位处于活跃状态，由 `twiceImgType` 控制
- 底部按钮栏允许用户切换当前上传位

**`changeTwiceImgType(val)`** — 切换到指定上传位（首帧/尾帧互斥）
**`switchTwiceImgType()`** — 交换首帧和尾帧

**`uploadTwiceImg(index)`** — 从画布导图上传
1. 检查是否选中画板/图片
2. 显示加载状态
3. 调用 `handlerRef.request('exportSingleSelection')` 导出选中内容
4. 检查图片尺寸（`checkImgSize`）
5. 转换 base64 并保存

**`startLocalUplaodTwiceImg(index)`** — 从本地上传
1. 创建隐藏的 file input (`accept=".png,.jpg,.jpeg"`)
2. 触发点击选择文件
3. 读取文件 → `arrayBuffer` → `Uint8Array`
4. 检查图片尺寸
5. 保存

**`delUploadTwiceImg(index)`** — 删除已上传的图片

#### 多图参考模式 (moreImg)

**结构说明**：
- 4个图片位，独立上传
- 每个上传位可以单独点击上传和删除

上传方法逻辑与首尾帧完全一致：`uploadMoreImg`、`startLocalUplaodMoreImg`、`delUploadMoreImg`

#### 图片尺寸检查

**`checkImgSize(width, height, unit8)`**：
```
// 最小边 < 300px → 不通过
// 最大边/最小边 比例 > 2.5 → 不通过
// 文件大小 > 10MB → 不通过
```

#### 从历史选择接收图片

**`sendHistorySelect(list)`** — 接收历史选择面板传来的图片列表
1. 遍历列表，将每张图片的 URL 转换为 `Uint8Array` 和 `base64`
2. 检查每张图片的尺寸
3. 根据 `createType` 填充到对应的图片列表

### 4.5 模式禁用逻辑

使用 `watch(twiceImgList, ...)` 监听首尾帧图片变化：
- **首尾帧模式**：如果首帧和尾帧都上传了图片 → 强制设为"高质量模式"并禁用模式选择
- 其他情况 → 允许用户自由选择模式

### 4.6 Prompt示例循环

**`enterPromptExample()`** — 填入随机示例
- 根据 `createType` 从不同的示例列表中取值：
  - 首尾帧：`videoCreateTwiceImgExampleConfig`
  - 多图参考：`videoCreateMoreImgExampleConfig`
- 除了填入 prompt，还会填充对应示例的图片（通过 `fetch` 请求示例图片资源）

### 4.7 一键生成

**`startCreate()`** — 核心API调用

1. **前置检查**：
   - 首尾帧模式：至少首帧有图片
   - 多图参考模式：至少有一张图且有 prompt

2. **API参数组装**：
```json
// 首尾帧 (task_type: i2v_seedance)
{
  "user": { "idx": "[user_id]" },
  "task_type": "i2v_seedance",
  "args": {
    "tag_name": "图生视频",
    "prompt": "...",
    "aspect_ratio": "1:1",
    "duration": "5",
    "count": 1,
    "mode": "std",
    "image": "base64数据（strip前缀）",
    "image_tail": "base64数据（strip前缀）"
  }
}

// 多图参考 (task_type: multi-i2v_seedance)
{
  "user": { "idx": "[user_id]" },
  "task_type": "multi-i2v_seedance",
  "args": {
    "tag_name": "图生视频",
    "prompt": "...",
    "aspect_ratio": "1:1",
    "duration": "5",
    "count": 1,
    "mode": "std",
    "image_list": [
      { "image": "base64数据" },
      { "image": "base64数据" }
    ]
  }
}
```

3. **错误处理**：与文生视频相同（5004/5008/5009/网络错误）

4. **埋点上报**：`createVideoUEM`，会将参考图上传到 CDN，将 URL 列表写入 txt 文件后上传，再上报埋点

### 4.8 外部方法

| 方法 | 说明 |
|------|------|
| `appCreateParam(val)` | 外部参数填充：根据 `task_type` 切换生成类型，加载图片和参数 |
| `quickToVideo(val)` | 快速转视频：加载单张图片到首帧位 |
| `appImgToVideo(obj)` | 传图到视频：将图片填入第一个空位 |

### 4.9 计算属性

**`createDisable`** — 按钮禁用条件：
- 首尾帧模式：首帧无图片时禁用
- 多图参考模式：无任何图片或 prompt 为空时禁用

### 4.10 对外暴露

```javascript
defineExpose({
  createType,          // 当前生成类型
  sendHistorySelect,   // 接收历史选择
  appCreateParam,      // 外部参数注入
  quickToVideo,        // 快速转视频
  appImgToVideo,       // 传图到视频
})
```

---

## 五、完整工作流程

### 5.1 页面加载 → 风险控制

```
进入视频创建页面
→ FusionVideoCreatePage.checkKlingCheckTip()
  → 如果用户未同意风险提示: 显示 FusionRiskControl
    → 同意 → isCheckKlingTip = true，关闭弹窗
    → 关闭/取消 → 跳转到创意生成页面
  → 如果已同意: 直接显示内容
```

### 5.2 文生视频 → 一键生成

```
用户输入 prompt + 选择参数 → 点击"一键生成"
→ FusionVideoCreateText.startCreate()
  → 校验 prompt 不为空
  → 组装参数 { task_type: 't2v_seedance', args: { prompt, aspect_ratio, duration, count, mode } }
  → buildCreateTask(paramData) 发起API请求
  → 处理响应:
    - 5004: 提示"最多同时3个任务"
    - 5008: 提示"敏感内容"
    - 5009: 提示自定义错误消息
    - error: 提示"网络错误"
    - 成功: 埋点上报 → 刷新历史列表
```

### 5.3 图生视频 → 一键生成

```
用户选择生成类型 + 上传参考图 + 输入 prompt → 点击"一键生成"
→ FusionVideoCreateImg.startCreate()
  → 校验: 首尾帧至少首帧有图 / 多图参考至少一张图且有 prompt
  → 根据 createType 组装不同参数
    → 首尾帧: task_type='i2v_seedance', args.image/image_tail
    → 多图参考: task_type='multi-i2v_seedance', args.image_list[]
  → buildCreateTask(paramData)
  → 处理响应（同文生视频）
  → 埋点上报（含图片URL txt文件）
  → 刷新历史列表
```

### 5.4 图片上传流程

```
本地文件上传:
点击上传 → document.createElement('input[type=file]') → click()
→ FileReader.readAsArrayBuffer → Uint8Array
→ 图片尺寸检查 (minSide >= 300, ratio <= 2.5, size <= 10MB)
→ bufferToBase64 → 存入 imgList

画布导出上传:
选中画布内容 → handlerRef.request('exportSingleSelection')
→ 图片尺寸检查 → bufferToBase64 → 存入 imgList

历史选择:
打开历史面板 → 选择图片 → sendHistorySelect(list)
→ 遍历 list: imageUrlToUint8Array → bufferToDataUrl
→ 图片尺寸检查 → 存入 imgList
```

---

## 六、关键技术细节

### 6.1 风险控制持久化

- `isCheckKlingTip` 是内存中的 boolean 变量，页面刷新后失效（不会持久化到 localStorage）
- 每次进入页面时由外部父组件调用 `checkKlingCheckTip()` 触发检查
- 埋点记录用户的操作（关闭/取消/同意）和时间

### 6.2 侧边面板管理

- 通过 `provide/inject` 模式注入面板控制方法
- 面板打开时会调用 `fusionHomeFunc.changeScreen()` 通知父组件
- `maxSelect` 根据生成类型动态变化（首尾帧最多2张，多图参考最多4张）

### 6.3 图生视频的两种模式

**首尾帧（twiceImg）**：
- 两个图片位：首帧图 + 尾帧图
- 当前活跃上传位由 `twiceImgType` 控制（0/1）
- 底部切换按钮允许用户指定上传到哪个位
- 首帧必填，尾帧可选
- 两个都上传后自动锁定为"高质量模式"

**多图参考（moreImg）**：
- 四个独立图片位
- 任意位置均可上传/删除
- 至少一张图即可生成
- 需要填写 prompt

### 6.4 API 参数差异

| 模式 | task_type | 图片参数 |
|------|-----------|---------|
| 文生视频 | `t2v_seedance` | 无 |
| 首尾帧 | `i2v_seedance` | `args.image` (首帧), `args.image_tail` (尾帧) |
| 多图参考 | `multi-i2v_seedance` | `args.image_list[]` |

### 6.5 公共组件复用

两个子组件共享以下公共组件和逻辑：
- `FusionSize` — 比例选择面板（sizeType="kling"）
- `FusionCountSelect` — 数量选择面板（countType="kling"）
- `vClickOutside` — 点击外部关闭下拉的指令
- `buildCreateTask` — API 请求封装
- `oTab` — Tab切换栏
- `oButton` — 一键生成按钮

### 6.6 下拉面板设计模式

所有下拉选项采用统一的设计模式：
```
1. 点击触发器 → 显示/隐藏下拉面板
2. 点击外部区域 (v-click-outside) → 关闭面板
3. 选择选项 (@click.stop) → 更新值 → 关闭面板
4. Transition name="FusionCreate-dropDown" 动画
5. 下拉箭头旋转动画 (rotate 180deg)
```

### 6.7 埋点上报策略

两个子组件的埋点上报使用各自的 UEM ID（相同但位置不同）：
- 文生视频：直接上报参数数据
- 图生视频：先将参考图上传到 CDN 获取 URL，将所有 URL 写入 txt 文件后上传 CDN，再上报埋点（包括 txt 文件的 URL）

### 6.8 图片处理流程

- 图片数据统一以 `Uint8Array` 和 `base64` 两种格式存储
- base64 存储时带 `data:image/jpeg;base64,` 前缀，API 发送时会 strip 前缀
- 从历史选择接收时，通过 `imageUrlToUint8Array` 加载远程图片
- 示例图片使用通过 `fetch` 获取资源路径

### 6.9 生成模式联动

首尾帧模式下，当首帧和尾帧都上传时，`watch` 监听器会自动执行：
```javascript
watch(twiceImgList, () => {
  if (createType.value !== 'twiceImg') { 不处理 }
  if (twiceImgList[0].imgBase64 && twiceImgList[1].imgBase64) {
    createVideoModeDisabled.value = true;
    createVideoMode.label = '高质量模式';
    createVideoMode.value = 'pro';
  } else {
    createVideoModeDisabled.value = false;
  }
}, { deep: true })
```