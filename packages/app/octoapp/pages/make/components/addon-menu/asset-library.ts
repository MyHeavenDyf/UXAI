import type { ArtifactFileKind } from "../../utils/artifact-file-api"
import excelIconUrl from "../../icons/Excel.svg"
import imgIconUrl from "../../icons/img.svg"
import htmlIconUrl from "../../icons/html.svg"
import pdfIconUrl from "../../icons/PDF.svg"
import pptIconUrl from "../../icons/ppt.svg"
import zipIconUrl from "../../icons/zip.svg"
import txtIconUrl from "../../icons/txt.svg"
import otherIconUrl from "../../icons/other.svg"

/**
 * 产品资源库数据获取层
 *
 * 登录态判断: !!localStorage.getItem('uiplusToken')
 * 非登录态: 返回 spec 里的 mock 数据
 * 登录态:
 *   1. GET baseUrl + /pipeline/rest.root/assetManagement/assetTeam/getBaseTeam?productId=X
 *      返回 { content: teamId },该 teamId 是根 team
 *   2. GET baseUrl + /pipeline/rest.root/assetManagement/assetTeam/getList?teamId=Y
 *      返回 { content: AssetFolder[] },每个 folder 有 children(子文件夹)
 *   3. GET baseUrl + /pipeline/rest.root/assetManagement/assetFile/getList?teamId=Z
 *      Z 是某文件夹的 id,返回 { content: AssetFile[] }
 */

export interface AssetFolder {
  name: string
  id: number
  children?: AssetFolder[]
}

export interface AssetVersionInfo {
  filePath: string
  fileName: string
  fileSize: number
}

export interface AssetFile {
  /** 资产唯一 id(服务端返回);chip 的唯一标识优先用它 */
  id?: number | string
  /** 资产类型:30 = 带版本信息的 HTML 容器(versionInfo 下载);40 = 普通文件(docId EDM 下载) */
  type?: number
  fileName: string
  /** type 30:缩略图路径(s3BaseUrl + snapshot);type 40 无此项,缩略图用后缀图标 */
  snapshot?: string
  s3BaseUrl?: string
  convertHtmlUrl?: string
  /** type 40:EDM 文档路径(下载路径 = s3BaseUrl + '/' + docPath) */
  docPath?: string
  /** type 40:EDM 下载所需的文档 id */
  docId?: string
  /** type 40:文件字节数 */
  fileSize?: number
  versionInfo?: AssetVersionInfo[] | null
}

export interface AssetNode {
  folders: AssetFolder[]
  files: AssetFile[]
}

/**
 * Infer an ArtifactFileKind from the convertHtmlUrl extension so product-asset
 * files can reuse getFileIcon (which needs a kind).
 */
export function inferKindFromUrl(url: string | null | undefined): ArtifactFileKind {
  if (!url) return "binary"
  const clean = url.split("?")[0].split("#")[0]
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase()
  switch (ext) {
    case "html":
    case "htm":
      return "html"
    case "svg":
      return "svg"
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
      return "image"
    case "mp4":
    case "webm":
    case "mov":
      return "video"
    case "mp3":
    case "wav":
    case "ogg":
      return "audio"
    case "md":
      return "markdown"
    case "pdf":
      return "pdf"
    case "txt":
      return "text"
    case "js":
    case "ts":
    case "json":
    case "css":
    case "xml":
      return "code"
    default:
      return "binary"
  }
}

const MOCK_TEAM_TREE: AssetFolder[] = [
  {
    name: "页面资产",
    id: 311100,
    children: [
      {
        name: "test1",
        id: 312220,
        children: [{ name: "test2", id: 312220 }],
      },
      { name: "test2", id: 323220 },
    ],
  },
]

const MOCK_FILES: AssetFile[] = [
  {
    type: 30,
    id: 1111,
    fileName: "容器1",
    snapshot: "image/ad270bbc7e41f8772b3d0bcc7be511fa53149cc8.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    convertHtmlUrl: "index.html",
    docPath: "assets/1753/2abc123123.xlsx",
    docId: "ASSET_421",
    fileSize: 1111,
    versionInfo: [
      { filePath: "/a/b", fileName: "source.zip", fileSize: 111111 },
    ],
  },
  {
    type: 30,
    id: 2222,
    fileName: "容器2",
    docPath: "assets/1753/2abc123123.xlsx",
    docId: "ASSET_421",
    fileSize: 1111,
    snapshot: "image/Iconolor.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    convertHtmlUrl: "index.html",
    versionInfo: null,
  },
  {
    type: 40,
    id: 3333,
    fileName: "产品效果图.png",
    docPath: "assets/1753/product-preview.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    fileSize: 20480,
  },
  {
    type: 40,
    id: 4444,
    fileName: "数据报表.xlsx",
    docPath: "assets/1753/report.xlsx",
    snapshot: "image/report-thumb.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    fileSize: 20480,
  },
]

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("uiplusToken")
}

function getBaseUrl(): string {
  return import.meta.env.VITE_OCTO_BASE_URL || ""
}

/**
 * Encode a URL that may contain non-ASCII characters (e.g. Chinese filenames in path).
 * encodeURI preserves reserved characters (: / ? # [ ] @ ! $ & ' ( ) * + , ; =)
 * so the base URL stays intact, only non-ASCII path segments get percent-encoded.
 */
export function encodeAssetUrl(url: string): string {
  try {
    return encodeURI(url)
  } catch {
    return url
  }
}

/**
 * Join a base URL and a path segment, ensuring exactly one "/" between them.
 * Handles cases where base has trailing "/" or path has leading "/".
 */
export function joinUrl(base: string | null | undefined, path: string | null | undefined): string {
  if (!base) return path || ""
  if (!path) return base
  if (base.endsWith("/")) {
    return base + path.replace(/^\/+/, "")
  }
  if (path.startsWith("/")) {
    return base + path
  }
  return base + "/" + path
}

/**
 * Unique id for an asset file chip. Prefer the server-returned file id
 * (prefixed "asset-" to avoid collisions with skill names / file paths);
 * fall back to joinUrl(s3BaseUrl, convertHtmlUrl) [+ fileName] when absent.
 */
export function assetFileId(file: AssetFile): string {
  if (file.id !== undefined && file.id !== null && `${file.id}` !== "") {
    return `asset-${file.id}`
  }
  const base = joinUrl(file.s3BaseUrl || "", file.convertHtmlUrl || "")
  if (file.convertHtmlUrl) return base
  return joinUrl(base, file.fileName)
}

async function getJson(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`请求失败: ${resp.status}`)
  return resp.json()
}

/**
 * 获取根 team 树(登录态)或 mock 树(非登录态)。
 * 返回的 folders 数组,每个 folder 的 children 已就位。
 */
export async function fetchTeamTree(productId?: number): Promise<AssetFolder[]> {
  if (!isLoggedIn()) {
    return MOCK_TEAM_TREE
  }
  const base = getBaseUrl()
  const teamResp = await getJson(
    `${base}/pipeline/rest.root/assetManagement/assetTeam/getBaseTeam?productId=${productId ?? ""}`,
  )
  const rootTeamId = teamResp?.content
  if (!rootTeamId) throw new Error("无产品权限")
  const listResp = await getJson(
    `${base}/pipeline/rest.root/assetManagement/assetTeam/getList?teamId=${rootTeamId}`,
  )
  const listRaw = listResp?.content
  return Array.isArray(listRaw) ? listRaw : []
}

/**
 * 获取某文件夹下的文件列表。
 * 非登录态: 返回 mock 文件(任何 teamId 都返回同一份)。
 * 登录态: GET assetFile/getAll?teamId=folderId&sortKey=createTime&sortType=desc(spec line 93)
 * 筛选(spec line 94):type 40 直接保留;type 30 筛掉没有 versionInfo 或该属性为空/空数组的项
 */
export async function fetchAssetFiles(teamId: number): Promise<AssetFile[]> {
  const filterByType = (files: AssetFile[]): AssetFile[] =>
    files.filter((f) => f.type === 40 || (Array.isArray(f.versionInfo) && f.versionInfo.length > 0))
  if (!isLoggedIn()) {
    return filterByType(MOCK_FILES)
  }
  const base = getBaseUrl()
  const resp = await getJson(
    `${base}/pipeline/rest.root/assetManagement/assetFile/getAll?teamId=${teamId}&sortKey=createTime&sortType=desc`,
  )
  const raw = resp?.content
  const files = Array.isArray(raw) ? raw : []
  return filterByType(files)
}

// ── type 40 文件的后缀图标(spec line 78-86)──
const EXT_ICON_MAP: Record<string, string> = {
  txt: txtIconUrl,
  xlsx: excelIconUrl,
  xlsm: excelIconUrl,
  xls: excelIconUrl,
  png: imgIconUrl,
  jpeg: imgIconUrl,
  jpg: imgIconUrl,
  svg: imgIconUrl,
  gif: imgIconUrl,
  html: htmlIconUrl,
  key: pdfIconUrl,
  pdf: pdfIconUrl,
  ppt: pptIconUrl,
  pptx: pptIconUrl,
  zip: zipIconUrl,
  rar: zipIconUrl,
}

/** png/jpeg/jpg/svg:直接显示下载路径的图片(不走图标) */
const IMAGE_EXT_SET = new Set(["png", "jpeg", "jpg", "svg"])

function extensionOf(fileName: string): string {
  const clean = fileName.split("?")[0].split("#")[0]
  const dot = clean.lastIndexOf(".")
  if (dot < 0 || dot === clean.length - 1) return ""
  return clean.slice(dot + 1).toLowerCase()
}

export type AssetThumbKind = "image" | "icon"

/**
 * type 40 缩略图的渲染方式(spec line 78-88):
 * - snapshot 有值 → "image"(s3BaseUrl + snapshot,同 type 30)
 * - snapshot 空/缺失:png/jpeg/jpg/svg → "image"(下载路径图片);其他后缀(html/txt/xlsx 等)→ "icon"(含 other.svg 兜底)
 * 仅处理 type 40;type 30 的缩略图由各渲染处直接用 snapshot(s3BaseUrl + snapshot)
 */
export function getAssetThumbKind(file: AssetFile): AssetThumbKind | undefined {
  if (file.type !== 40) return undefined
  if (file.snapshot) return "image"
  if (IMAGE_EXT_SET.has(extensionOf(file.fileName))) return "image"
  return "icon"
}

/** type 40 缩略图 URL:image 返回对应 URL(snapshot 优先,缺失用下载路径),icon 返回图标 URL(other.svg 兜底) */
export function getAssetThumb(file: AssetFile): string | undefined {
  const kind = getAssetThumbKind(file)
  if (!kind) return undefined
  if (kind === "icon") {
    const ext = extensionOf(file.fileName)
    return EXT_ICON_MAP[ext] || otherIconUrl
  }
  if (file.snapshot) {
    return encodeAssetUrl(joinUrl(file.s3BaseUrl, file.snapshot))
  }
  return encodeAssetUrl(joinUrl(file.s3BaseUrl, file.docPath))
}

/** type 40 缩略图是否为真实图片(决定渲染样式:铺满 scale-down vs 居中图标) */
export function isAssetThumbImage(file: AssetFile): boolean {
  return getAssetThumbKind(file) === "image"
}

/** 按 fileName 后缀取对应图标 URL(图片类返回 img.svg);未知后缀兜底 other.svg */
export function getAssetIconByExtension(fileName: string): string | undefined {
  const ext = extensionOf(fileName)
  return EXT_ICON_MAP[ext] || otherIconUrl
}
