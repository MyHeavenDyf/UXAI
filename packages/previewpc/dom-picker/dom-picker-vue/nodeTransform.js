import path from 'node:path'
import { ElementTypes, NodeTypes } from '@vue/compiler-core'

const ATTRIBUTE_NAME = 'data-dom-picker-source'
const CWD = globalThis.process?.cwd?.() ?? ''

function isVueComponent(node) {
  if (node.type !== NodeTypes.ELEMENT || node.tagType !== ElementTypes.COMPONENT) {
    return false
  }

  return typeof node.tag === 'string'
}

function createTextNode(content, loc) {
  return {
    type: NodeTypes.TEXT,
    content,
    loc,
  }
}

// 获取元素标识符（#id 或 标签.class），与 React 版本一致
function getElementIdentifier(node) {
  let id = ''
  let className = ''
  const tagName = node.tag || ''

  for (const prop of node.props) {
    if (prop.type !== NodeTypes.ATTRIBUTE) continue

    const attrName = prop.name

    // 获取 id
    if (attrName === 'id' && prop.value?.type === NodeTypes.TEXT) {
      id = prop.value.content
    }

    // 获取 class（Vue 用 class，React 用 className）
    if ((attrName === 'class' || attrName === 'className') && prop.value?.type === NodeTypes.TEXT) {
      className = prop.value.content
    }
  }

  // 优先返回 #id 格式
  if (id) return `{#${id} `

  // 其次返回 标签.class 格式（取第一个 class）
  if (className) {
    const firstClass = className.split(/\s+/)[0]
    return `{${tagName}.${firstClass} `
  }

  // 都没有则只返回 {
  return '{'
}

export default function createDomPickerVueNodeTransform() {
  return (node, context) => {
    if (node.type !== NodeTypes.ELEMENT) {
      return
    }

    const shouldMarkNativeElement = node.tagType === ElementTypes.ELEMENT
    const shouldMarkComponent = isVueComponent(node)

    if (!shouldMarkNativeElement && !shouldMarkComponent) {
      return
    }

    const hasMarker = node.props.some(
      (prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === ATTRIBUTE_NAME,
    )

    if (hasMarker || !node.loc?.start?.line || !node.loc?.end?.line) {
      return
    }

    const relativeFilename = path
      .relative(CWD, context.filename || '')
      .split(path.sep)
      .join('/')

    // 获取元素标识符前缀（与 React 版本一致）
    const identifier = getElementIdentifier(node)

    // 格式：{#id @project/path:L1-2} 或 {tag.class @project/path:L1-2}
    const location = `${identifier}@project/${relativeFilename}:L${node.loc.start.line}-${node.loc.end.line}}`

    node.props.push({
      type: NodeTypes.ATTRIBUTE,
      name: ATTRIBUTE_NAME,
      nameLoc: node.loc,
      value: createTextNode(location, node.loc),
      loc: node.loc,
    })
  }
}
