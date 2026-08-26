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

export interface AssetFile {
  fileName: string
  snapshot: string
  s3BaseUrl: string
  convertHtmlUrl: string
}

export interface AssetNode {
  folders: AssetFolder[]
  files: AssetFile[]
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
    fileName: "容器1",
    snapshot: "image/ad270bbc7e41f8772b3d0bcc7be511fa53149cc8.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    convertHtmlUrl: "index.html",
  },
  {
    fileName: "容器2",
    snapshot: "image/Iconolor.png",
    s3BaseUrl: "http://127.0.0.1:8080/",
    convertHtmlUrl: "index.html",
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
  if (!rootTeamId) throw new Error("获取根 team 失败")
  const listResp = await getJson(
    `${base}/pipeline/rest.root/assetManagement/assetTeam/getList?teamId=${rootTeamId}`,
  )
  return (listResp?.content as AssetFolder[]) ?? []
}

/**
 * 获取某文件夹下的文件列表。
 * 非登录态: 返回 mock 文件(任何 teamId 都返回同一份)。
 * 登录态: GET assetFile/getList?teamId=folderId
 */
export async function fetchAssetFiles(teamId: number): Promise<AssetFile[]> {
  if (!isLoggedIn()) {
    return MOCK_FILES
  }
  const base = getBaseUrl()
  const resp = await getJson(
    `${base}/pipeline/rest.root/assetManagement/assetFile/getList?teamId=${teamId}`,
  )
  return (resp?.content as AssetFile[]) ?? []
}
