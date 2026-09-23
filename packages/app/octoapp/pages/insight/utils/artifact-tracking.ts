// Capture identity with the original prompt; artifact reporting itself is server-only.
export function artifactTrackingExtra() {
  const read = (key: string): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") ?? {}
    } catch {
      return {}
    }
  }
  const user = read("userInfo")
  const app = read("appInfo")
  return {
    artifactTracking: {
      module: "insight",
      uid: typeof user.userId === "string" ? user.userId : undefined,
      version: typeof app.version === "string" ? app.version : undefined,
    },
  }
}
