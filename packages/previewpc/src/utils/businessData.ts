/**
 * getIconInfo 接口打点数据
 * 支持两种数据来源：
 *   1. 通过 postMessage 从父页面接收（优先）
 *   2. 直接从 localStorage.userInfo 读取
 * 找不到数据时不追加 businessData 参数
 */

export interface BusinessData {
  uuid?: string           // 当前登录的用户信息
  account?: string        // 当前登录的用户工号
  agentType?: string      // 在哪个Agent使用的
  seesionId?: string      // 客户端对应的sessionID
  octoProjectId?: number  // 用户选的项目空间的版本的ID
  userLocalPath?: string  // 用户选的关联本地文件夹目录路径
}

/** 通过 postMessage 接收的业务数据（优先级高） */
let _postedBusinessData: BusinessData | null = null

/**
 * 存储通过 postMessage 接收的 businessData
 * 由 PreviewPage.vue 中 BUSINESS_DATA 消息触发
 */
export function setBusinessData(data: BusinessData | null): void {
  _postedBusinessData = data
}

/**
 * 获取 businessData，优先使用 postMessage 传入的数据，其次从 localStorage 读取
 */
function getBusinessData(): BusinessData | null {
  // 优先使用 postMessage 传入的数据
  if (_postedBusinessData) return _postedBusinessData

  // 尝试从 localStorage 读取
  try {
    const raw = localStorage.getItem('userInfo')
    if (!raw) return null
    const data = JSON.parse(raw)
    // 过滤掉空值
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null && value !== '') {
        filtered[key] = value
      }
    }
    return Object.keys(filtered).length > 0 ? (filtered as BusinessData) : null
  } catch {
    return null
  }
}

/**
 * 构建 businessData 查询参数字符串，无数据时返回空串（不追加参数）
 */
export function getBusinessDataParam(): string {
  const data = getBusinessData()
  if (!data) return ''
  return `&businessData=${encodeURIComponent(JSON.stringify(data))}`
}
