import { SurfaceModel } from './surfaceModel'
import type { JsonInput, DataValue } from './type'
import { processJsonForIcons } from '../../composables/useIconProvider'

// 管理所有surface，配合使用useSyncExternalStore实现精确更新
export class SurfaceStore {
    private surfaces: Map<string, SurfaceModel> = new Map()
    private subscribers: Map<string, Set<() => void>> = new Map();

    createSurface(id: string, json: JsonInput) {
        this.setSurfSurface(id, json)
    }

    updateSurface(id: string, json: JsonInput) {
        this.setSurfSurface(id, json)
    }

    addImportantToClasses(classNameStr: string) {
        if (!classNameStr) return ''
        return classNameStr
        .trim()
        .split(/\s+/)
        .map((cls: string) => {
            if (cls.includes('!')) return cls
            if (cls.includes(':')) {
            const lastColonIndex = cls.lastIndexOf(':')
            return cls.substring(0, lastColonIndex + 1) + '!' + cls.substring(lastColonIndex + 1)
            }
            return '!' + cls
        })
        .join(' ')
    }
    private setImportantClassName(json: JsonInput) {
        if (Array.isArray(json?.elements)) {
            json.elements.forEach((item) => {
                const className = item.props?.className
                if (item.props && className) {
                    item.props.className = this.addImportantToClasses(className)
                }
            })
        }
    }

    private setSurfSurface(id: string, json: JsonInput) {
        const oldSurface = this.getSurface(id);
        if (oldSurface) {
            oldSurface.dispose();
            this.surfaces.delete(id);
        }
        const surface = new SurfaceModel(id);
        this.surfaces.set(id, surface)
        this.setImportantClassName(json)
        // 收集 JSON 中的图标引用并调用 API 映射（当 @hui/icon-plus-vue 存在时）
        processJsonForIcons(json)
        surface.parserJson(json)
        this.notify(id);
    }

    deleteSurface(id: string) {
        const surface = this.getSurface(id);
        if (surface) {
            surface.dispose();
        }
        this.surfaces.delete(id)
        this.subscribers.delete(id)
    }

    deleteSurfaces() {
        this.surfaces.forEach(s => s.dispose())
        this.surfaces.clear()
        this.subscribers.clear()
    }

    getSurfaces(): SurfaceModel[] {
        return Array.from(this.surfaces.values())
    }

    getSurface(id: string): SurfaceModel | undefined {
        return this.surfaces.get(id)
    }

    subscribeToSurface(surfaceId: string, callback: () => void): () => void {
        if (!this.subscribers.has(surfaceId)) {
            this.subscribers.set(surfaceId, new Set());
        }
        this.subscribers.get(surfaceId)?.add(callback);
        return () => this.subscribers.get(surfaceId)?.delete(callback);
    }

    setData(surfaceId: string,
        path: string,
        value: DataValue,
    ) {
        const surface = this.getSurface(surfaceId)
        if (!surface) return
        surface.setData(path, value)
    }

    getData(surfaceId: string, path: string) {
        const surface = this.getSurface(surfaceId)
        if (!surface) return null;
        return surface.getData(path)
    }

    private notify(surfaceId: string): void {
        this.subscribers.get(surfaceId)?.forEach(cb => cb());
    }
}
