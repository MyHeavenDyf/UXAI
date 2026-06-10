import { ref, provide, inject } from 'vue'
import { SurfaceStore } from '../processor/surfaceStore'
import type { JsonInput, DataValue, A2UIClientEventMessage } from '../processor/type'

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

export function provideA2UI(onAction?: (message: A2UIClientEventMessage) => void): A2UIContextProps {
    const store = new SurfaceStore()
    const onActionRef = ref(onAction ?? null)

    const actions: A2UIActionsProps = {
        createSurface: (id: string, json: JsonInput) => {
            store.createSurface(id, json);
        },
        updateSurface: (id: string, json: JsonInput) => {
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