---

## 概述

### 什么是 Bridge Scripts

Bridge Scripts 是注入到 HTML iframe 中的 JavaScript 代码片段，用于实现父窗口与预览内容之间的双向通信和交互功能。

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│  父窗口 (React Application)                                  │
│  - 用户界面                                                  │
│  - 状态管理                                                  │
│  - 发送指令 (postMessage)                                    │
│  - 接收事件 (addEventListener)                               │
└─────────────────────────────────────────────────────────────┘
                              ↕ postMessage
┌─────────────────────────────────────────────────────────────┐
│  iframe (预览内容)                                          │
│  - Bridge Scripts (注入)                                    │
│  - 监听消息                                                  │
│  - 处理事件                                                  │
│  - 上报状态                                                  │
└─────────────────────────────────────────────────────────────┘
```

```

**注入时机**：
1. 读取 HTML 文件内容
2. 解码 HTML（处理编码）
3. 根据配置注入 bridges
4. 返回修改后的 HTML

**注入位置**：
- **脚本**：注入到 `</body>` 前
- **样式**：注入到 `</head>` 前

### 条件注入机制

自定义 bridge 可以通过特定命名完全替代标准 bridge 功能：

| customBridges 值 | 禁用的标准 bridge | 说明 |
|-----------------|-------------------|------|
| `'custom-comment'` | commentBridge | 自定义标注功能 |
| `'custom-snapshot'` | snapshotBridge | 自定义归档/快照功能 |

当配置了这些特定名称时，`getBridgeConfigForSubtype` 会自动禁用对应的标准 bridge，并通过 `SubtypeHandler` 的 `handleComment` 或 `handleArchive` 方法处理相应操作。

**配置示例**：

```typescript
// packages/app/octoapp/pages/make/utils/subtype-config.ts
export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  mytype: {
    features: { comment: true },
    rendering: {
      customBridges: ['custom-comment']  // ← 使用自定义标注
    }
  }
}

// packages/app/octoapp/pages/make/subtype-handlers/mytype.ts
const mytypeHandler: SubtypeHandler = {
  name: 'mytype',
  handleComment: async (ctx) => {
    // 自定义标注逻辑
    return true  // 已处理
  }
}
```

### 消息协议

#### 命名规范

```typescript
// 消息类型格式：od:{功能}-{动作}
type: 'od:edit-mode'              // 模式开关
type: 'od:edit-selected'          // 元素选择
type: 'od:edit-preview-style'     // 样式预览
type: 'od:comment-target'         // 评论目标
type: 'od:snapshot'               // 截图请求
```

#### 消息结构

```typescript
interface Message {
  type: string          // 必填：消息类型
  id?: string           // 可选：唯一标识符
  enabled?: boolean     // 可选：模式开关
  // ... 其他业务数据
}
```

#### 通信方向

```
父窗口 → iframe (指令)
  - od:edit-mode { enabled: true }
  - od:inspect-set { elementId, prop, value }
  - od:comment-mode { enabled: true }

iframe → 父窗口 (事件/状态)
  - od:edit-selected { target: {...} }
  - od:inspect-overrides { overrides: [...] }
  - od:comment-target { elementId, ... }
```

---

## 快速开始

### 最简示例

#### 1. 创建 Bridge Script

```typescript
// 注册一个简单的日志 bridge
import { registerCustomBridge } from '../utils/custom-bridge-registry'

registerCustomBridge('my-logger', {
  script: `
(function() {
  console.log('[MyBridge] Loaded')
  
  window.addEventListener('message', function(e) {
    if (e.data.type === 'od:my-log') {
      console.log('[MyBridge]', e.data.message)
    }
  })
})()
  `
})
```

#### 2. 配置 Subtype

```typescript
// packages/app/octoapp/pages/make/utils/subtype-config.ts
export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  mytype: {
    features: { /* ... */ },
    rendering: {
      customBridges: ['my-logger']  // ← 引用自定义 bridge
    }
  }
}
```

#### 3. 在桌面端同步注册

```typescript
// packages/desktop/src/main/custom-bridge-registry.ts
registerCustomBridge('my-logger', {
  script: `... 同样的 script ...`
})
```

#### 4. 验证效果

```bash
# 1. 创建测试文件：test.mytype.html
# 2. 在应用中打开此文件
# 3. 打开浏览器开发者工具 → Console
# 4. 应该看到：[MyBridge] Loaded
```

---

### 发送消息验证

**从父窗口发送消息**：

```typescript
// 在某个组件中（如 manual-edit-panel.tsx）
const sendMessageToBridge = () => {
  iframeRef?.contentWindow?.postMessage({
    type: 'od:my-log',
    message: 'Hello from parent!'
  }, '*')
}

// 调用
sendMessageToBridge()

// 预期在 Console 中看到：
// [MyBridge] Hello from parent!
```

---

## 核心概念

### Bridge Script 结构

#### 标准模板

```javascript
`<script data-od-{bridge-name}>(function(){
  // 1. 私有变量
  var enabled = false
  var state = {}
  
  // 2. 私有函数
  function handleEnable() { ... }
  function handleDisable() { ... }
  
  // 3. 消息监听
  window.addEventListener('message', function(e) {
    var data = e && e.data
    if (!data || !data.type) return
    
    if (data.type === 'od:xxx-mode') {
      if (data.enabled) handleEnable()
      else handleDisable()
    }
  })
  
  // 4. 用户交互监听
  document.addEventListener('click', function(e) {
    if (!enabled) return
    // 处理点击
  }, true)
  
  // 5. 初始化
  console.log('[MyBridge] Loaded')
})();</script>`
```

#### 关键要素

| 要素 | 说明 | 示例 |
|------|------|------|
| `data-od-*` 属性 | 标识 bridge | `data-od-my-bridge` |
| IIFE 包裹 | 隔离作用域 | `(function(){ ... })()` |
| 状态变量 | 管理模式状态 | `var enabled = false` |
| 消息监听 | 接收父窗口指令 | `window.addEventListener('message', ...)` |
| 事件监听 | 处理用户交互 | `document.addEventListener('click', ...)` |
| 日志输出 | 调试支持 | `console.log('[MyBridge] ...')` |

---

### 消息类型定义

#### 输入消息（从父窗口接收）

```typescript
// 模式开关
type: 'od:mybridge-mode'
enabled: boolean

// 数据更新
type: 'od:mybridge-update'
id: string
value: any

// 查询请求
type: 'od:mybridge-get'
id?: string
```

#### 输出消息（发送到父窗口）

```typescript
// 状态上报
type: 'od:mybridge-state'
enabled: boolean
data?: any

// 事件通知
type: 'od:mybridge-event'
eventType: 'select' | 'change' | 'error'
detail?: any

// 查询响应
type: 'od:mybridge-result'
id: string
data: any
```
---

## 详细指南

### 步骤 1：设计 Bridge 功能

#### 确定需求

**问题清单**：

1. 这个 bridge 的主要功能是什么？
2. 需要监听哪些用户事件？（点击、键盘、鼠标移动）
3. 需要与父窗口通信哪些信息？
4. 需要持久化什么状态？
5. 有哪些副作用需要清理？

**示例**：Shadcn 组件编辑器

```yaml
功能：识别和编辑 shadcn 组件
监听事件：
  - 点击：选择组件
  - 双击：进入编辑
通信信息：
  - 组件选择事件
  - 组件属性变更
持久化状态：
  - 当前选中的组件
  - 组件属性缓存
副作用：
  - 高亮 overlay
  - 事件监听器
```

---

### 步骤 2：编写 Bridge Script

#### 基本框架

```javascript
const bridgeScript = `
(function() {
  'use strict'
  
  // ===== 1. 私有变量 =====
  var BRIDGE_NAME = 'my-bridge'
  var enabled = false
  var activeComponent = null
  var overlay = null
  
  // ===== 2. 工具函数 =====
  function log(msg) {
    console.log('[' + BRIDGE_NAME + ']', msg)
  }
  
  function postMessage(data) {
    try {
      window.parent.postMessage(data, '*')
    } catch(e) {
      log('postMessage failed: ' + e.message)
    }
  }
  
  // ===== 3. 核心逻辑 =====
  function enable() {
    if (enabled) return
    enabled = true
    
    document.documentElement.setAttribute('data-od-mybridge-mode', 'true')
    
    createOverlay()
    log('Enabled')
  }
  
  function disable() {
    if (!enabled) return
    enabled = false
    
    document.documentElement.removeAttribute('data-od-mybridge-mode')
    
    removeOverlay()
    activeComponent = null
    log('Disabled')
  }
  
  function createOverlay() {
    overlay = document.createElement('div')
    overlay.style.cssText = 
      'position:fixed;pointer-events:none;z-index:99999;' +
      'border:2px solid #3b82f6;border-radius:3px;' +
      'background:rgba(59,130,246,0.08);transition:all 80ms ease;'
    overlay.style.display = 'none'
    document.body.appendChild(overlay)
  }
  
  function removeOverlay() {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
    }
    overlay = null
  }
  
  function updateOverlay(element) {
    if (!overlay || !element) {
      if (overlay) overlay.style.display = 'none'
      return
    }
    
    var rect = element.getBoundingClientRect()
    overlay.style.left = rect.left + 'px'
    overlay.style.top = rect.top + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
    overlay.style.display = 'block'
  }
  
  // ===== 4. 事件处理 =====
  function handleClick(e) {
    if (!enabled) return
    
    var target = e.target
    var component = target.closest('[data-my-component]')
    
    if (component) {
      e.preventDefault()
      e.stopPropagation()
      
      activeComponent = component
      updateOverlay(component)
      
      postMessage({
        type: 'od:mybridge-component-selected',
        component: component.getAttribute('data-my-component'),
        elementId: component.getAttribute('data-od-id'),
        label: component.textContent.trim().slice(0, 50)
      })
    }
  }
  
  // ===== 5. 消息监听 =====
  window.addEventListener('message', function(e) {
    var data = e && e.data
    if (!data || !data.type) return
    
    if (data.type === 'od:mybridge-mode') {
      if (data.enabled) enable()
      else disable()
    }
    
    if (data.type === 'od:mybridge-select') {
      var el = document.querySelector('[data-od-id="' + data.elementId + '"]')
      if (el) {
        activeComponent = el
        updateOverlay(el)
      }
    }
  })
  
  // ===== 6. 事件监听 =====
  document.addEventListener('click', handleClick, true)
  document.addEventListener('mouseover', function(e) {
    if (!enabled) return
    var component = e.target.closest('[data-my-component]')
    updateOverlay(component)
  }, true)
  
  // ===== 7. 初始化 =====
  log('Loaded')
})()
`
```

---

### 步骤 3：注册到 Registry

#### 应用层注册

```typescript
// packages/app/octoapp/pages/make/subtype-handlers/mytype.ts
import { registerCustomBridge } from '../utils/custom-bridge-registry'

registerCustomBridge('my-component-editor', {
  script: bridgeScript,  // 上面的脚本内容
  style: `
/* 全局样式 */
html[data-od-mybridge-mode] body * {
  cursor: pointer !important;
}

[data-my-component] {
  position: relative;
}

[data-my-component]:hover {
  outline: 1px dashed rgba(59, 130, 246, 0.5);
  outline-offset: 2px;
}
  `,
  position: 'body'
})

const mytypeHandler: SubtypeHandler = {
  name: 'mytype',
  // ...
}
```

#### 桌面端注册（必须同步）

```typescript
// packages/desktop/src/main/custom-bridge-registry.ts
import { registerCustomBridge } from './custom-bridge-registry'

// 注册相同的 bridge（内容要完全一致）
registerCustomBridge('my-component-editor', {
  script: bridgeScript,  // 相同的内容
  style: `...`,          // 相同的内容
  position: 'body'
})
```

---

### 步骤 4：配置 Subtype 引用

```typescript
// packages/app/octoapp/pages/make/utils/subtype-config.ts
export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  mytype: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,    // 禁用标准编辑
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    },
    rendering: {
      customBridges: ['my-component-editor']  // ← 引用自定义 bridge
    }
  }
}
```

---

### 步骤 5：在父窗口监听消息

```typescript
// packages/app/octoapp/pages/make/components/result-viewer/mytype-panel.tsx
import { createSignal, onCleanup } from 'solid-js'

export function MyTypePanel(props: { iframeRef: HTMLIFrameElement | null }) {
  const [selectedComponent, setSelectedComponent] = createSignal<string>()
  
  const handleMessage = (e: MessageEvent) => {
    const data = e.data
    if (!data || !data.type) return
    
    if (data.type === 'od:mybridge-component-selected') {
      console.log('Component selected:', data.component)
      setSelectedComponent(data.component)
      // 执行特定逻辑...
    }
  }
  
  window.addEventListener('message', handleMessage)
  onCleanup(() => window.removeEventListener('message', handleMessage))
  
  const enableMyBridgeMode = () => {
    props.iframeRef?.contentWindow?.postMessage({
      type: 'od:mybridge-mode',
      enabled: true
    }, '*')
  }
  
  return (
    <div>
      <button onClick={enableMyBridgeMode}>启用编辑</button>
      {selectedComponent() && <div>选中: {selectedComponent()}</div>}
    </div>
  )
}
```

---

## 消息协议规范

### 命名约定

#### 消息类型前缀

```typescript
// 格式：od:{功能}-{动作}
'od:edit-mode'              // ✅ 正确
'od:edit-selected'          // ✅ 正确
'edit-mode'                 // ❌ 错误（缺少前缀）
'od:editMode'               // ❌ 错误（应使用连字符）
```

#### 标准消息类型

| 类别 | 消息类型 | 说明 |
|------|---------|------|
| **模式控制** | `od:{name}-mode` | 启用/禁用模式 |
| **状态上报** | `od:{name}-state` | 上报当前状态 |
| **选择事件** | `od:{name}-selected` | 元素/对象被选择 |
| **变更事件** | `od:{name}-changed` | 数据发生变更 |
| **查询请求** | `od:{name}-get` | 查询数据 |
| **查询响应** | `od:{name}-result` | 返回查询结果 |
| **错误上报** | `od:{name}-error` | 上报错误 |

---

### 标准字段

#### 输入消息（父窗口 → iframe）

```typescript
interface InputMessage {
  type: string           // 必填：消息类型
  
  // 模式控制
  enabled?: boolean      // 启用/禁用
  
  // 数据操作
  id?: string            // 元素 ID
  value?: any            // 新值
  prop?: string          // 属性名
  
  // 查询参数
  query?: string         // 查询条件
  limit?: number         // 结果限制
}
```

#### 输出消息（iframe → 父窗口）

```typescript
interface OutputMessage {
  type: string           // 必填：消息类型
  
  // 状态信息
  enabled?: boolean      // 当前状态
  id?: string            // 元素 ID
  
  // 数据载荷
  data?: any             // 业务数据
  result?: any           // 查询结果
  
  // 元信息
  error?: string         // 错误信息
  timestamp?: number     // 时间戳
}
```

---

### 常用消息类型

#### editBridge 消息协议

```typescript
// 启用/禁用编辑模式
{ type: 'od:edit-mode', enabled: boolean }

// 元素选择事件
{ type: 'od:edit-selected', target: TargetInfo }

// 文本编辑提交
{ type: 'od-edit-text-commit', id: string, value: string }

// 样式预览
{ type: 'od:edit-preview-style', id: string, styles: object }
```

#### commentBridge 消息协议

```typescript
// 启用/禁用评论模式
{ type: 'od:comment-mode', enabled: boolean }

// 评论目标选择
{ type: 'od:comment-target', elementId?: string, selector?: string, ... }

// Pin 点击事件
{ type: 'od:comment-pin-click', commentId: string }
```

#### inspectBridge 消息协议

```typescript
// 设置样式
{ type: 'od:inspect-set', elementId: string, prop: string, value: string }

// 重置样式
{ type: 'od:inspect-reset', elementId?: string }

// 提取样式覆盖
{ type: 'od:inspect-extract' }
```