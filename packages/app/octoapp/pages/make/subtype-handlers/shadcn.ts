import type { SubtypeHandler, LocalEditChange, LocalEditSavePayload } from './types'
import type { ManualEditTarget, ManualEditStyles } from '../edit-mode/source-patches'
import { uploadZip } from '@/utils/useZipTransport'
import { registerCustomBridge } from '../utils/custom-bridge-registry'
import { sendTextToAgent } from '../utils/agent-events'

registerCustomBridge('shadcn-component-editor', {
  script: `
(function() {
  console.log('[ShadcnBridge] Loaded')
  
  window.addEventListener('message', function(e) {
    if (e.data.type === 'od:shadcn-edit') {
      console.log('[ShadcnBridge] Edit mode:', e.data.enabled)
    }
  })
  
  document.addEventListener('click', function(e) {
    const target = e.target
    if (target && target.matches('[data-shadcn-component]')) {
      e.preventDefault()
      e.stopPropagation()
      window.parent.postMessage({
        type: 'od:shadcn-component-selected',
        component: target.getAttribute('data-shadcn-component')
      }, '*')
    }
  }, true)
})()
  `,
  style: `
[data-shadcn-component]:hover {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  cursor: pointer;
}
  `,
  position: 'body'
})

function formatChange(change: LocalEditChange): string {
  switch (change.kind) {
    case 'text':
      return `修改文本：${quote(change.before)} → ${quote(change.after)}`
    case 'href':
      return `修改链接地址：${change.before || '(空)'} → ${change.after || '(空)'}`
    case 'styles':
      return change.changes
        .map((s) => `修改样式 ${s.prop}：${s.before || '(未设置)'} → ${s.after || '(清除)'}`)
        .join('\n')
    case 'remove-element':
      return '删除该元素'
    case 'image':
      return `修改图片：src → ${change.src}${change.alt ? `，alt → ${change.alt}` : ''}`
  }
}

function quote(value: string): string {
  return value ? `"${value}"` : '(空)'
}

/**
 * Build the local-edit save payload from the pending edit session state.
 * Consumed by handleLocalEditSave to turn the user's changes into a prompt.
 */
export function buildLocalEditPayload(
  target: ManualEditTarget,
  pendingStyle: { id: string; styles: ManualEditStyles; label: string } | null,
  pendingText: { id: string; text: string; href: string } | null,
  initialStyles: ManualEditStyles | null,
): LocalEditSavePayload {
  const changes: LocalEditChange[] = []

  if (pendingStyle?.styles) {
    const styleChanges: Array<{ prop: string; before: string; after: string }> = []
    for (const [prop, value] of Object.entries(pendingStyle.styles)) {
      const before = initialStyles?.[prop as keyof ManualEditStyles] ?? ''
      if (before !== value) {
        styleChanges.push({ prop, before, after: value })
      }
    }
    if (styleChanges.length > 0) changes.push({ kind: 'styles', changes: styleChanges })
  }

  if (pendingText && pendingText.id === target.id) {
    if (target.kind === 'link') {
      const beforeHref = target.fields.href ?? ''
      if (pendingText.href !== beforeHref) {
        changes.push({ kind: 'href', before: beforeHref, after: pendingText.href })
      }
      const beforeText = target.fields.text ?? target.text ?? ''
      if (pendingText.text !== beforeText) {
        changes.push({ kind: 'text', before: beforeText, after: pendingText.text })
      }
    } else if (target.kind === 'text' || target.kind === 'mixed') {
      const beforeText = target.fields.text ?? target.text ?? ''
      if (pendingText.text !== beforeText) {
        changes.push({ kind: 'text', before: beforeText, after: pendingText.text })
      }
    }
  }

  return { target, changes }
}

export default {
  name: 'shadcn',
  
  async handleLocalEditSave(ctx) {
    const { tab, edit, showToast } = ctx
    const target = edit.target

    const filePath = tab.filePath || tab.absoluteFilePath
    const lines: string[] = []
    lines.push(`请修改文件「${tab.title}」${filePath ? `（${filePath}）` : ''}。`)
    lines.push('需要修改的是 `<script type="text/plain" id="page-tsx">` 内的代码。')
    lines.push('')
    lines.push('页面中渲染出的目标元素 DOM 信息：')
    lines.push(`- 选择器：${target.selector || '(未知)'}`)
    lines.push(`- 标签：<${target.tagName}>`)
    if (target.className) {
      lines.push(`- 类名：${target.className}`)
    }
    if (target.text) {
      lines.push(`- 当前文本：${target.text}`)
    }
    lines.push(`- 位置与尺寸（bounding box）：x=${target.rect.x} y=${target.rect.y} w=${target.rect.width} h=${target.rect.height}`)
    if (target.htmlHint) {
      lines.push(`- 元素片段：${target.htmlHint}`)
    }
    const attrKeys = Object.keys(target.attributes || {})
    if (attrKeys.length > 0) {
      lines.push(`- 属性：${attrKeys.map((k) => `${k}="${target.attributes[k]}"`).join(' ')}`)
    }
    lines.push('')
    lines.push('需要做的变更：')
    for (const change of edit.changes) {
      lines.push(formatChange(change))
    }
    lines.push('')
    lines.push('请编辑现有文件，修改与上述目标元素对应的代码。')

    const result = await sendTextToAgent(lines.join('\n'), { source: 'local-edit' })
    if (result.ok) {
      showToast({ title: '已提交修改请求' })
    } else {
      showToast({ title: '提交失败', description: result.message ?? '请重试' })
    }
    return result.ok
  },

  async handleCanvasEdit(ctx) {
    const { tab, showToast, getDesktopApi, projectSelection } = ctx
    const filePath = tab.filePath || tab.absoluteFilePath
    
    if (!filePath) {
      showToast({ title: "无法获取文件路径" })
      return true
    }

    const dir = filePath.replace(/[/\\][^/\\]+$/, '')
    let zipName = tab.title
    if (zipName.toLowerCase().endsWith('.html')) {
      zipName = zipName.slice(0, -5)
    }
    zipName += '.zip'
    const zipPath = dir + '/' + zipName

    const api = getDesktopApi()
    if (!api?.readFileBuffer) {
      showToast({ title: "不支持本地文件读取" })
      return true
    }

    const buffer = await api.readFileBuffer(zipPath)
    if (!buffer) {
      showToast({ title: "ZIP文件不存在", description: zipPath })
      return true
    }

    const isLoggedIn = !!localStorage.getItem('uiplusToken')
    const zipBlob = new Blob([buffer], { type: "application/zip" })

    if (!isLoggedIn) {
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = zipName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast({ title: "下载完成" })
      return true
    }

    const result = await uploadZip(async () => zipBlob, projectSelection())
    console.log('pixsourl', result?.pixsoUrl)

    if (!result.webview) {
      showToast({ title: "创建失败" })
      return true
    }

    console.log('pixso loaded')
    return true
  },
} satisfies SubtypeHandler
