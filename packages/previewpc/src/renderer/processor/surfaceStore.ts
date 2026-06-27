import { SurfaceModel } from './surfaceModel'
import type { JsonInput, DataValue } from './type'

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

    private setSurfSurface(id: string, json: JsonInput) {
        const oldSurface = this.getSurface(id);
        if (oldSurface) {
            oldSurface.dispose();
            this.surfaces.delete(id);
        }
        const surface = new SurfaceModel(id);
        this.surfaces.set(id, surface)
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
