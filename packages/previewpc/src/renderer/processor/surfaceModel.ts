import { DataModel } from './dataModel';
import { ComponentModel } from './componentModel';
import type { SurfaceId, ComponentInstance, JsonInput, AnyComponentNode } from './type'
import { DataContext } from './dataContext'

class SurfaceModel {
    readonly id: SurfaceId
    // 数据
    private _dataModel: DataModel = null!;
    private _dataContext: DataContext = null!
    // 根节点id
    private rootId: string | null = null
    private _componentTree: AnyComponentNode | null = null
    private components: Map<string, ComponentInstance> = new Map()

    constructor(id: string) {
        this.id = id;
    }

    get dataModel(): DataModel {
        return this._dataModel!;
    }

    get componentTree() {
        return this._componentTree
    }

    parserJson(json: JsonInput) {
        const { state, elements, rootId } = json
        if (!rootId) {
            throw new Error('rootId is required')
        }
        this.rootId = rootId;
        this._dataModel = new DataModel(state)
        this._dataContext = new DataContext(this._dataModel, "/")  // 根上下文
        this.components = new Map(elements.map(e => [e.id, e]))
        this._componentTree = new ComponentModel(
            this.rootId,
            this.components,
            this._dataModel,
            this._dataContext
        ).componentTree
    }

    getData(
        absolutePath: string,
    ) {
        return this._dataModel?.get(absolutePath) ?? undefined
    }

    setData(absolutePath: string, value: unknown): void {
        this._dataModel?.set(absolutePath, value)
    }

    /**
     * 清理内部资源，帮助 GC 回收
     */
    dispose(): void {
        this.rootId = null
        this._componentTree = null
        this.components.clear()
        ;(this as any)._dataModel = null
        ;(this as any)._dataContext = null
    }
}

export { SurfaceModel }
