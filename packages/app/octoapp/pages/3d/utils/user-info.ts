// 从 localStorage.userInfo 读取当前登录用户身份(昵称/账号/头像 URL)
// 与 make 页面 html-renderer.tsx 的 getCommenterInfo 保持一致,供批注创建/弹窗/归档复用
export function getAvatarUrl(account: string): string {
  if (!account) return ""
  return `https://octo.hdesign.huawei.com/w3lab/rest/yellowpage/face/${account.replace(/^[a-zA-Z]/, "")}/120?ts=${Date.now()}`
}

export function getCommenterInfo(): { account: string; userName: string; avatar: string } {
  const fallback = { account: "", userName: "用户", avatar: "" }
  const userInfoStr = localStorage.getItem("userInfo")
  if (!userInfoStr) return fallback
  try {
    const obj = JSON.parse(userInfoStr) as { nickName?: string; account?: string }
    const account = obj.account || ""
    const userName = obj.nickName || "用户"
    return { account, userName, avatar: getAvatarUrl(account) }
  } catch {
    return fallback
  }
}
