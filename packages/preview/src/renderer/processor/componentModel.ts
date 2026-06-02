/*
 * ComponentModel - 单个组件模型
 */
import type { ComponentInstance, AnyComponentNode, ComponentChildren, ResolvedValue, ResolvedMap } from './type'
import { isObject, isTemplateChildren, isDataBinding, isComponentNode } from "./guards.ts";
import { DataModel } from './dataModel.ts';
import { DataContext } from './dataContext'

export class ComponentModel {
    readonly id: string;
    private dataModel: DataModel;
    private dataContext: DataContext
    private idSuffix: string
    private name: string
    private props: Record<string, any> = {}
    private children?: AnyComponentNode[] | null;
    private initProperties: ComponentInstance
    private components: Map<string, ComponentInstance>
    constructor(
        id: string,
        components: Map<string, ComponentInstance>,
        dataModel: DataModel,
        dataContext: DataContext,
        idSuffix: string = ""
    ) {
        this.id = id;
        this.components = components
        this.dataModel = dataModel
        this.dataContext = dataContext
        this.idSuffix = idSuffix
        this.buildComponent()
    }

    buildComponent() {
        if (!this.components.has(this.id)) {
            return null;
        }
        const componentData = this.components.get(this.id);
        this.initProperties = componentData!
        this.name = componentData!.component
        const componentProps = componentData?.props ?? {};
        const resolvedProperties = {}
        const children = componentData?.children
        for (const [key, value] of Object.entries(componentProps)) {
            resolvedProperties[key] = this.resolvePropertyValue(value);
        }
        this.props = resolvedProperties
        if (children) {
            this.children = this.resolveChildren(children)
        }
    }

    resolvePropertyValue(
        value: unknown,
    ): ResolvedValue {
        // 1. 字符串且是组件 id，递归 buildComponent
        // if (typeof value === "string" && this.components.has(value)) {
        //     return new ComponentModel(
        //         value,
        //         this.components,
        //         this.dataModel,
        //         this.dataContext,
        //         this.idSuffix
        //     ).componentTree
        // }

        if (isComponentNode(value) && this.components.has(value.componentId)) {
            return new ComponentModel(
                value.componentId,
                this.components,
                this.dataModel,
                this.dataContext,
                this.idSuffix
            ).componentTree
        }

        // 2. 数组，递归每个元素
        if (Array.isArray(value)) {
            return value.map((item) =>
                this.resolvePropertyValue(item)
            );
        }

        // 3. path binding 对象：{ path: "..." }，用 ctx 转成绝对路径
        if (isDataBinding(value)) {
            const absolutePath = this.dataContext.resolvePath(value.path)
            return { path: absolutePath }
        }

        // 4. 普通对象，递归每个字段
        if (isObject(value)) {
            const result: ResolvedMap = {}
            for (const [k, v] of Object.entries(value)) {
                result[k] = this.resolvePropertyValue(v)
            }
            return result
        }

        // 5. Otherwise, it's a primitive value.
        return value as ResolvedValue;
    }

    resolveChildren(
        value: ComponentChildren,
    ) {

        if (Array.isArray(value)) {
            return value.map((id) => new ComponentModel(id, this.components, this.dataModel, this.dataContext, this.idSuffix).componentTree);
        }

        if (isTemplateChildren(value)) {
            const listAbsPath = this.dataContext.resolvePath(value.path)
            const listData = this.dataModel.get(listAbsPath)
            const templateId = value.componentId
            if (!Array.isArray(listData)) return []
            return listData.map((_, index) => {
                // 用 nested 推进到当前迭代元素的上下文
                const itemCtx = this.dataContext.nested(`${listAbsPath}/${index}`)

                // 从当前 ctx.path 里提取已有数字段，保证嵌套循环 id 唯一
                const parentIndices = this.dataContext.path
                    .split("/")
                    .filter(s => /^\d+$/.test(s))
                const itemSuffix = `:${[...parentIndices, index].join(":")}`

                return new ComponentModel(
                    templateId,
                    this.components,
                    this.dataModel,
                    itemCtx,
                    itemSuffix
                ).componentTree
            })
        }
        return null
    }

    get componentTree(): AnyComponentNode {
        const properties = this.props
        if (this.children) {
            properties.children = this.children
        }
        return {
            id: `${this.id}${this.idSuffix}`,
            weight: this.initProperties?.weight ?? "initial",
            type: this.name,
            properties
        }
    }
}