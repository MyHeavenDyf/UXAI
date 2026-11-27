export async function checkUpdateReadiness(connection?: { url: string; username: string; password: string }) {
  if (!connection) return { ready: false, reason: "后台服务尚未就绪，请稍后重试更新。" }
  return fetch(new URL("/global/update-readiness", connection.url), {
    headers: { Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}` },
    signal: AbortSignal.timeout(5000),
  }).then(async (response) => {
    if (!response.ok) throw new Error("无法检查后台任务状态")
    const result: unknown = await response.json()
    if (!result || typeof result !== "object" || !("ready" in result) || typeof result.ready !== "boolean") {
      throw new Error("后台任务状态无效")
    }
    return {
      ready: result.ready,
      reason: "reason" in result && typeof result.reason === "string" ? result.reason : undefined,
    }
  }).catch(() => ({ ready: false, reason: "无法确认后台任务状态，请稍后重试更新。" }))
}
