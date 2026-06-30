import { getDesktopApi } from "../lib/electron-api"

const STORAGE_PREFIX = "octo:dslToHex:artifact"
const ARTIFACT_DIR = ".octo/dslToHex"

type StepKey = "a" | "b" | "c"

function artifactPath(projectDir: string, sessionId: string, step: StepKey) {
  if (step === "c") return `${projectDir}/${ARTIFACT_DIR}/${sessionId}/output.zip`
  return `${projectDir}/${ARTIFACT_DIR}/${sessionId}/step-${step}.json`
}

function localStorageKey(sessionId: string, step: StepKey) {
  return `${STORAGE_PREFIX}:${sessionId}:${step}`
}

// ── manifest：每个项目一份 sessionId → 目标步骤(1|2|3) 的索引 ──
// 冷启动时内存缓存为空，靠这份磁盘 manifest 给步骤推断提供初始提示，
// 消除"切到已生成 session 先闪步骤一再跳目标步骤"。它只是提示，产物到达后仍以产物为准。
export type Manifest = Record<string, number>

function manifestPath(projectDir: string) {
  return `${projectDir}/${ARTIFACT_DIR}/index.json`
}

function manifestStorageKey(projectDir: string) {
  return `${STORAGE_PREFIX}:manifest:${projectDir}`
}

export async function loadManifest(projectDir: string): Promise<Manifest> {
  const api = getDesktopApi()
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(manifestPath(projectDir))
      if (!buf || buf.byteLength === 0) return {}
      return JSON.parse(new TextDecoder().decode(buf)) as Manifest
    } catch {
      return {}
    }
  }
  const stored = localStorage.getItem(manifestStorageKey(projectDir))
  if (!stored) return {}
  try {
    return JSON.parse(stored) as Manifest
  } catch {
    return {}
  }
}

export async function saveManifest(projectDir: string, manifest: Manifest): Promise<void> {
  const api = getDesktopApi()
  const json = JSON.stringify(manifest)
  if (api?.writeFileBuffer) {
    await api.writeFileBuffer(manifestPath(projectDir), new TextEncoder().encode(json).buffer)
    return
  }
  localStorage.setItem(manifestStorageKey(projectDir), json)
}

export async function saveArtifact(
  projectDir: string,
  sessionId: string,
  step: StepKey,
  data: string | ArrayBuffer,
): Promise<void> {
  const api = getDesktopApi()
  const path = artifactPath(projectDir, sessionId, step)

  if (api?.writeFileBuffer) {
    if (typeof data === "string") {
      const encoder = new TextEncoder()
      await api.writeFileBuffer(path, encoder.encode(data).buffer)
    } else {
      await api.writeFileBuffer(path, data)
    }
    return
  }

  if (typeof data === "string") {
    localStorage.setItem(localStorageKey(sessionId, step), data)
  } else {
    const bytes = new Uint8Array(data)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    localStorage.setItem(localStorageKey(sessionId, step), btoa(binary))
  }
}

export async function loadArtifact(
  projectDir: string,
  sessionId: string,
  step: StepKey,
): Promise<string | ArrayBuffer | null> {
  const api = getDesktopApi()
  const path = artifactPath(projectDir, sessionId, step)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf || buf.byteLength === 0) return null
      if (step === "c") return buf
      return new TextDecoder().decode(buf)
    } catch {
      return null
    }
  }

  const stored = localStorage.getItem(localStorageKey(sessionId, step))
  if (!stored) return null
  if (step === "c") {
    const binary = atob(stored)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }
  return stored
}

export async function clearArtifacts(
  projectDir: string,
  sessionId: string,
  ...steps: StepKey[]
): Promise<void> {
  const targets = steps.length > 0 ? steps : ["a", "b", "c"] as StepKey[]
  const api = getDesktopApi()

  if (api?.writeFileBuffer) {
    for (const step of targets) {
      const path = artifactPath(projectDir, sessionId, step)
      try {
        // 桌面端没有删除接口，只能写空内容。但若文件本就不存在/已空，
        // 就不要写——否则会凭空创建 0 字节的 step-b.json / output.zip，
        // 看起来像"没确认却生成了步骤二/三产物"。先读，只截断有内容的文件。
        const existing = api.readFileBuffer ? await api.readFileBuffer(path) : null
        if (existing && existing.byteLength > 0) {
          await api.writeFileBuffer(path, new ArrayBuffer(0))
        }
      } catch {}
    }
    return
  }

  for (const step of targets) {
    localStorage.removeItem(localStorageKey(sessionId, step))
  }
}
