import type { SubtypeHandler } from './types'
import type { SubtypeHandlerContext } from './types'

let editing = false
let messageHandler: ((e: MessageEvent) => void) | null = null
let currentCtx: SubtypeHandlerContext | null = null

export function isPrototypeEditing() {
  return editing
}

export function resetPrototypeEditing() {
  editing = false
  currentCtx = null
  if (messageHandler) {
    window.removeEventListener("message", messageHandler)
    messageHandler = null
  }
}

export type PrototypeEditTarget = {
  elementId: string
  tagName: string
  className: string
  text: string
  rect: { top: number; left: number; width: number; height: number }
  styles: Record<string, string>
  outerHtml: string
}

const PROTOTYPE_EDIT_EVENT = "prototype:edit-selected"

export function dispatchPrototypeEditTarget(target: PrototypeEditTarget) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_EDIT_EVENT, { detail: target }))
}

export function onPrototypeEditTarget(handler: (target: PrototypeEditTarget) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeEditTarget>).detail)
  window.addEventListener(PROTOTYPE_EDIT_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_EDIT_EVENT, listener)
}

export default {
  name: 'prototype',

  async handleLocalEdit(ctx) {
    debugger
  },
} satisfies SubtypeHandler
