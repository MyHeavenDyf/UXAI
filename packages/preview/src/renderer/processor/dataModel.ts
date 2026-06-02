/*
 * DataModel - 状态数据管理
 */
export class DataModel {
    private data: Record<string, unknown>

    constructor(initialData: Record<string, unknown> = {}) {
        this.data = initialData
    }

    get(path: string): unknown {
        if (path === "/" || path === "") return this.data

        const segments = this.parsePath(path)
        let current: unknown = this.data
        for (const segment of segments) {
            if (current == null) return undefined
            current = (current as any)[segment]
        }
        return current
    }

    set(path: string, value: unknown): void {
        if (path === "/" || path === "") {
            this.data = value as Record<string, unknown>
            return
        }

        const segments = this.parsePath(path)
        const lastSegment = segments.pop()!
        let current: any = this.data

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]
            if (current[segment] == null) {
                const next = i < segments.length - 1 ? segments[i + 1] : lastSegment
                current[segment] = /^\d+$/.test(next) ? [] : {}
            }
            current = current[segment]
        }

        if (value === undefined) {
            Array.isArray(current)
                ? (current[parseInt(lastSegment)] = undefined)
                : delete current[lastSegment]
        } else {
            current[lastSegment] = value
        }
    }

    getData(): Record<string, unknown> {
        return this.data
    }

    private parsePath(path: string): string[] {
        return path.split("/").filter(s => s.length > 0)
    }
}