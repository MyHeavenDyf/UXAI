import { useA2UI } from './Provider'
import { ref, onUnmounted } from 'vue'
import type { SurfaceModel } from '../processor/surfaceModel'
import type { DynamicString, DynamicNumber, DynamicBoolean, DataValue, AnyComponentNode, Action, DynamicStringList } from '../processor/type'

export { useA2UI }

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

    return {
        resolveValue,
        setValue,
        getValue,
        sendAction,
        getUniqueId,
    }
}