import type { PrototypeCtxMenuData, PrototypeEditTarget, PrototypeQuickFixData } from "./types"

const PROTOTYPE_EDIT_EVENT = "prototype:edit-selected"
const PROTOTYPE_CTX_MENU_EVENT = "prototype:ctx-menu"
const PROTOTYPE_QUICK_FIX_EVENT = "prototype:quick-fix"
const PROTOTYPE_CLOSE_PANELS_EVENT = "prototype:close-panels"

export function dispatchPrototypeEditTarget(target: PrototypeEditTarget) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_EDIT_EVENT, { detail: target }))
}

export function onPrototypeEditTarget(handler: (target: PrototypeEditTarget) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeEditTarget>).detail)
  window.addEventListener(PROTOTYPE_EDIT_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_EDIT_EVENT, listener)
}

export function dispatchPrototypeCtxMenu(data: PrototypeCtxMenuData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_CTX_MENU_EVENT, { detail: data }))
}

export function onPrototypeCtxMenu(handler: (data: PrototypeCtxMenuData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeCtxMenuData>).detail)
  window.addEventListener(PROTOTYPE_CTX_MENU_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_CTX_MENU_EVENT, listener)
}

export function dispatchPrototypeQuickFix(data: PrototypeQuickFixData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_QUICK_FIX_EVENT, { detail: data }))
}

export function onPrototypeQuickFix(handler: (data: PrototypeQuickFixData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeQuickFixData>).detail)
  window.addEventListener(PROTOTYPE_QUICK_FIX_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_QUICK_FIX_EVENT, listener)
}

export function dispatchPrototypeClosePanels() {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_CLOSE_PANELS_EVENT))
}

export function onPrototypeClosePanels(handler: () => void) {
  const listener = () => handler()
  window.addEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
}
