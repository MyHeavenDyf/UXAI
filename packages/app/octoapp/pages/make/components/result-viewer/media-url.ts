// file:// 在 Electron renderer 被 webSecurity 拦截,剥协议走 local:/// 自定义协议;
// https?/data: 直通。媒体 renderer(audio/image/pdf/video)共用。
export function resolveMediaUrl(filePath: string, refreshKey: number): string {
  if (/^(https?:|data:)/i.test(filePath)) return filePath
  const stripped = filePath.replace(/^file:\/\//i, "")
  return `local:///${stripped.replace(/\\/g, "/")}?v=${refreshKey}`
}
