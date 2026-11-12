import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { FileManagerMedia } from "./studio-file-manager"

export type HistoryMedia = Omit<FileManagerMedia, "sessionID"> & { sessionID: string }

type ApiMediaItem = {
  id: string
  sessionID: string
  generationID: string
  mediaIndex: number
  kind: "image" | "video"
  url: string
  thumbnailUrl?: string
  thumbnailStatus?: string
  width?: number
  height?: number
  aspectRatio?: string
  capability?: string
  duration?: string
  createdAt: number
}

function mapApiItem(item: ApiMediaItem): HistoryMedia {
  return {
    id: item.id,
    turnID: "",
    generationID: item.generationID,
    mediaIndex: item.mediaIndex,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    thumbnailStatus: item.thumbnailStatus as FileManagerMedia["thumbnailStatus"],
    kind: item.kind,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    capability: item.capability,
    duration: item.duration,
    createdAt: item.createdAt,
    sessionID: item.sessionID,
  }
}

export type StudioHistoryPageParams = {
  kind?: "image" | "video"
  resolutions?: string[]
  ratios?: string[]
  sort?: "desc" | "asc"
  cursor?: string
  limit?: number
}

export type StudioHistoryPage = {
  items: HistoryMedia[]
  nextCursor?: string
}

export async function fetchHistoryMedia(
  client: OpencodeClient,
  params: StudioHistoryPageParams = {},
): Promise<StudioHistoryPage> {
  const result = await client.studio.history.list({
    kind: params.kind,
    resolution: params.resolutions?.length ? params.resolutions.join(",") : undefined,
    ratio: params.ratios?.length ? params.ratios.join(",") : undefined,
    sort: params.sort,
    cursor: params.cursor,
    limit: params.limit,
  })
  const data = result.data as { items?: ApiMediaItem[]; nextCursor?: string } | undefined
  return {
    items: (data?.items ?? []).map(mapApiItem),
    nextCursor: data?.nextCursor,
  }
}

export type StudioHistoryRevision = {
  revision: string
  count: number
  headId?: string
  headCreatedAt?: number
}

// 轻量指纹：客户端在重新查询前先取它，未变化则复用缓存，避免每次都跑完整列表查询。
export async function fetchHistoryRevision(client: OpencodeClient): Promise<StudioHistoryRevision | undefined> {
  const result = await client.studio.history.revision()
  return result.data as StudioHistoryRevision | undefined
}

export async function fetchExcludedMediaIds(client: OpencodeClient): Promise<Set<string>> {
  const result = await client.studio.history.excluded.list()
  const ids = (result.data as { ids?: string[] } | undefined)?.ids ?? []
  return new Set(ids)
}

export async function deleteHistoryMedia(client: OpencodeClient, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return
  await client.studio.history.delete({ mediaIds })
}
