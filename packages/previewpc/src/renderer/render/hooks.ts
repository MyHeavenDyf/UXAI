import { useA2UI } from './Provider'
import { ref, onUnmounted } from 'vue'
import type { SurfaceModel } from '../processor/surfaceModel'
import type { DynamicString, DynamicNumber, DynamicBoolean, DataValue, AnyComponentNode, Action, DynamicStringList } from '../processor/type'

export { useA2UI }

/**
 * 执行一个交互动作对象（onClick / onClose 的值）。
 * 集中处理 A2UI 协议的动作语义，避免在各组件里重复硬编码分支。
 *
 * - setState：把 args.value 写入 args.path。
 * - cycleState：把 args.path 的当前值在 args.value 数组中推进到下一项，
 *   越过末尾后回到首项（协议 Scenario 3）。
 *
 * 返回 true 表示动作已被处理；false 表示未识别/参数缺失，调用方可回退到 legacy 派发。
 */
export interface ActionApi {
    getValue: (path: string) => DataValue | null
    setState: (path: string, value: DataValue) => void
}

export interface ActionObject {
    action: string
    args?: { path?: string; value?: DataValue; [k: string]: unknown }
}

export function executeAction(
    action: ActionObject | undefined | null,
    api: ActionApi
): boolean {
    if (!action || !action.action) return false
    switch (action.action) {
        case "setState": {
            const { path, value } = action.args ?? {}
            if (path) {
                api.setState(path, value as DataValue)
                return true
            }
            return false
        }
        case "cycleState": {
            const { path, value } = action.args ?? {}
            if (!path || !Array.isArray(value) || value.length === 0) return false
            const current = api.getValue(path)
            const currentStr = current == null ? "" : String(current)
            // 当前值不在数组中时 idx=-1，next=0 → 复位到首项
            const idx = value.findIndex((v) => String(v) === currentStr)
            const nextIdx = (idx + 1) % value.length
            api.setState(path, value[nextIdx] as DataValue)
            return true
        }
        default:
            return false
    }
}

export function useSurface(surfaceId: string) {
    const { store } = useA2UI()
    const surface = ref<SurfaceModel | undefined>(undefined)
    
    const unsubscribe = store.subscribeToSurface(surfaceId, () => {
        surface.value = store.getSurface(surfaceId) as SurfaceModel | undefined
    })
    
    surface.value = store.getSurface(surfaceId) as SurfaceModel | undefined
    
    onUnmounted(() => {
        unsubscribe()
    })
    
    return surface
}

export interface UseA2UIComponentResult {
    setValue: (path: string, value: DataValue) => void;
    getValue: (path: string) => DataValue | null;
    sendAction: (action: Action) => void;
    getUniqueId: (prefix: string) => string;
    resolveValue: (value: DynamicString | DynamicNumber | DynamicBoolean | null | undefined | DynamicStringList) => string | null | number | boolean | DataValue
    commitActivation: (propName: string, value: DataValue) => void;
    setState: (path: string, value: DataValue) => void;
}

let globalIdCounter = 0

export function useA2UIComponent<T extends AnyComponentNode<any>>(
    node: T,
    surfaceId: string
): UseA2UIComponentResult {
    const context = useA2UI()
    const baseId = `id-${++globalIdCounter}`

    const resolveValue = (value: DynamicString | DynamicNumber | DynamicBoolean | null | undefined | DynamicStringList): string | null | number | boolean | DataValue => {
        
        if (!value) return null
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            return value
        }
        if (typeof value !== 'object') {
            return null
        }
        if (Array.isArray(value)) {
            return value
        }
        if (value.path) {
            return context.getData(surfaceId, value.path) as DataValue
        }
        return value as unknown as DataValue
    }

    const setValue = (path: string, value: DataValue) => {
        context.setData(surfaceId, path, value)
    }

    const getValue = (path: string): DataValue | null => {
        return context.getData(surfaceId, path) as DataValue | null
    }

    const sendAction = (action: Action) => {
        const actionContext: Record<string, unknown> = {}
        if (action.context) {
            for (const [key, value] of Object.entries(action.context)) {
                if (value === null || typeof value !== "object" || Array.isArray(value)) {
                    actionContext[key] = value
                } else if ("path" in value) {
                    actionContext[key] = context.getData(surfaceId, value.path)
                }
            }
        }

        context.dispatch({
            userAction: {
                name: action.name,
                sourceComponentId: node.id,
                surfaceId,
                timestamp: new Date().toISOString(),
                context: actionContext,
            },
        })
    }

    const getUniqueId = (prefix: string) => {
        return `${prefix}${baseId}`
    }

    const commitActivation = (propName: string, value: DataValue) => {
        const raw = (node.properties as Record<string, unknown> | undefined)?.[propName]
        const bindingPath = raw && typeof raw === 'object' && !Array.isArray(raw) && 'path' in (raw as Record<string, unknown>)
            ? (raw as { path: string }).path
            : undefined
        if (bindingPath) {
            context.setData(surfaceId, bindingPath, value)
            context.store.notify(surfaceId)
        }
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
            const msg: { type: string; elementId: unknown; propName: string; value: DataValue; path?: string } = {
                type: 'A2UI_STATE_CHANGE',
                elementId: node.id,
                propName,
                value,
            }
            if (bindingPath) msg.path = bindingPath
            window.parent.postMessage(msg, '*')
        }
    }

    const setState = (path: string, value: DataValue) => {
        context.setData(surfaceId, path, value)
        context.store.notify(surfaceId)
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'A2UI_STATE_CHANGE',
                propName: path,
                value,
                path,
            }, '*')
        }
    }

    return {
        resolveValue,
        setValue,
        getValue,
        sendAction,
        getUniqueId,
        commitActivation,
        setState,
    }
}