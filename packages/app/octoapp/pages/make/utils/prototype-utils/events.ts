import type { PrototypeCtxMenuData, PrototypeEditTarget, PrototypeQuickFixData, PrototypeRectUpdateData } from "./types"

const PROTOTYPE_EDIT_EVENT = "prototype:edit-selected"
const PROTOTYPE_CTX_MENU_EVENT = "prototype:ctx-menu"
const PROTOTYPE_QUICK_FIX_EVENT = "prototype:quick-fix"
const PROTOTYPE_RECT_UPDATE_EVENT = "prototype:rect-update"
const PROTOTYPE_CLOSE_PANELS_EVENT = "prototype:close-panels"
const PROTOTYPE_PICKER_SUBMIT_EVENT = "prototype:picker-submit"
const PROTOTYPE_PICKER_APPEND_EVENT = "prototype:picker-append"

export type PrototypePickerData = { text: string; id: string; kind?: 'a2ui' | 'host' }

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

export function dispatchPrototypeRectUpdate(data: PrototypeRectUpdateData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_RECT_UPDATE_EVENT, { detail: data }))
}

export function onPrototypeRectUpdate(handler: (data: PrototypeRectUpdateData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypeRectUpdateData>).detail)
  window.addEventListener(PROTOTYPE_RECT_UPDATE_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_RECT_UPDATE_EVENT, listener)
}

export function dispatchPrototypeClosePanels() {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_CLOSE_PANELS_EVENT))
}

export function onPrototypeClosePanels(handler: () => void) {
  const listener = () => handler()
  window.addEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_CLOSE_PANELS_EVENT, listener)
}

export function dispatchPrototypePickerSubmit(data: PrototypePickerData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_PICKER_SUBMIT_EVENT, { detail: data }))
}

export function onPrototypePickerSubmit(handler: (data: PrototypePickerData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypePickerData>).detail)
  window.addEventListener(PROTOTYPE_PICKER_SUBMIT_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_PICKER_SUBMIT_EVENT, listener)
}

export function dispatchPrototypePickerAppend(data: PrototypePickerData) {
  window.dispatchEvent(new CustomEvent(PROTOTYPE_PICKER_APPEND_EVENT, { detail: data }))
}

export function onPrototypePickerAppend(handler: (data: PrototypePickerData) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PrototypePickerData>).detail)
  window.addEventListener(PROTOTYPE_PICKER_APPEND_EVENT, listener)
  return () => window.removeEventListener(PROTOTYPE_PICKER_APPEND_EVENT, listener)
}
