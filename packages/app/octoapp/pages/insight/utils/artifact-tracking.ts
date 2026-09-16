/** The backend fixes ownership per originating turn; no independent renderer rollout flag. */
export function legacyArtifactParts<T>(parts: T[], userParts: unknown[] = []): T[] {
  const owner = userParts
    .map((p) =>
      p && typeof p === "object"
        ? (p as { metadata?: { octoArtifactOwner?: string } }).metadata?.octoArtifactOwner
        : undefined,
    )
    .find(Boolean)
  return parts.filter((part) => {
    if (!part || typeof part !== "object") return true
    const state = (part as { state?: { metadata?: { octoArtifactOwner?: string } } }).state
    return (state?.metadata?.octoArtifactOwner ?? owner) !== "server"
  })
}

export function artifactIdentityExtra() {
  try {
    const user: { userId?: unknown } = JSON.parse(localStorage.getItem("userInfo") ?? "{}")
    const app: { version?: unknown } = JSON.parse(localStorage.getItem("appInfo") ?? "{}")
    return {
      artifactTracking: {
        ...(typeof user.userId === "string" ? { uid: user.userId } : {}),
        ...(typeof app.version === "string" ? { version: app.version } : {}),
      },
    }
  } catch {
    return { artifactTracking: {} }
  }
}
