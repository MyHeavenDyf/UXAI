// DataContext.ts
import { DataModel } from './DataModel'

export class DataContext {
    readonly dataModel: DataModel
    readonly path: string

    constructor(dataModel: DataModel, path: string = "/") {
        this.dataModel = dataModel
        this.path = path
    }

    // 取值
    get(relativePath: string): unknown {
        const absolutePath = this.resolvePath(relativePath)
        return this.dataModel.get(absolutePath)
    }

    // 写值
    set(relativePath: string, value: unknown): void {
        const absolutePath = this.resolvePath(relativePath)
        this.dataModel.set(absolutePath, value)
    }

    // 创建子上下文，循环迭代时用
    nested(relativePath: string): DataContext {
        const newPath = this.resolvePath(relativePath)
        return new DataContext(this.dataModel, newPath)
    }

    // 相对路径转绝对路径
    resolvePath(path: string): string {
        if (path.startsWith("/")) return path
        if (path === "" || path === ".") return this.path

        let base = this.path
        if (base.endsWith("/") && base.length > 1) base = base.slice(0, -1)
        if (base === "/") base = ""

        return `${base}/${path}`
    }
}