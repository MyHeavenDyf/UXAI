export interface ElementRect {
  top: number
  left: number
  width: number
  height: number
}

export interface ContainerSize {
  width: number
  height: number
}

export interface ModifyElementData {
  elementId: string
  className: string
  textContent: string
  componentProps: Record<string, string | boolean>
  tag?: string
  keepOpen?: boolean
  saveToHistory?: boolean
}
