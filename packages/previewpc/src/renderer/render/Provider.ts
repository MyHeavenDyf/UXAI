import { ref, provide, inject } from 'vue'
import { SurfaceStore } from '../processor/surfaceStore'
import type { JsonInput, DataValue, A2UIClientEventMessage } from '../processor/type'
import { processJsonForIcons, hasHuiIcons } from '../../composables/useIconProvider'

export interface A2UIActionsProps {
    createSurface: (id: string, json: JsonInput) => void;
    updateSurface: (id: string, json: JsonInput) => void;
    setData: (
        surfaceId: string,
        path: string,
        value: DataValue,
    ) => void;
    getData: (
        surfaceId: string,
        path: string,
    ) => unknown;
    dispatch: (message: any) => void;
}

export interface A2UIContextProps extends A2UIActionsProps {
    store: SurfaceStore
}

const A2UI_CONTEXT_KEY = Symbol('A2UIContext')

/** 图标解析超时（ms），超时后降级为 lucide */
const ICON_RESOLVE_TIMEOUT = 60000

export function provideA2UI(onAction?: (message: A2UIClientEventMessage) => void): A2UIContextProps {
    const store = new SurfaceStore()
    const onActionRef = ref(onAction ?? null)

    const actions: A2UIActionsProps = {
        createSurface: async (id: string, json: JsonInput) => {
            // 等待图标映射完成再渲染，避免先 lucide 后 hui 的闪烁
            if (hasHuiIcons.value) {
                await Promise.race([
                    processJsonForIcons(json),
                    new Promise<void>((resolve) => setTimeout(resolve, ICON_RESOLVE_TIMEOUT)),
                ])
            }
            store.createSurface(id, json);
        },
        updateSurface: async (id: string, json: JsonInput) => {
            // 等待图标映射完成再渲染
            if (hasHuiIcons.value) {
                await Promise.race([
                    processJsonForIcons(json),
                    new Promise<void>((resolve) => setTimeout(resolve, ICON_RESOLVE_TIMEOUT)),
                ])
            }
            store.updateSurface(id, json);
        },
        setData: (
            surfaceId: string,
            path: string,
            value: DataValue,
        ) => {
            store.setData(surfaceId, path, value);
        },
        getData: (surfaceId: string, path: string) => {
            return store.getData(surfaceId, path);
        },
        dispatch: (message: A2UIClientEventMessage) => {
            if (onActionRef.value) {
                void onActionRef.value(message);
            }
        }
    }

    const contextValue: A2UIContextProps = {
        store,
        ...actions
    }

    provide(A2UI_CONTEXT_KEY, contextValue)

    return contextValue
}

export function useA2UI(): A2UIContextProps {
    const context = inject<A2UIContextProps>(A2UI_CONTEXT_KEY)
    if (!context) throw new Error('useA2UI must be used within A2UIProvider')
    return context
}