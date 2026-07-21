import { readdir, mkdir, mkdtemp, rm } from "node:fs/promises"
import { networkInterfaces, tmpdir } from "node:os"
import path from "node:path"

type JobStatus = "queued" | "running" | "success" | "failed"
type BuildTarget = "mac-arm64" | "mac-x64" | "win-x64"
type Artifact = { name: string; size: number }
type Job = {
  id: string
  baseBranch: string
  branch: string
  version: string
  channel: "beta" | "prod"
  target: BuildTarget
  status: JobStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  log: string
  artifacts: Artifact[]
}

const rootDir = path.resolve(import.meta.dir, "..")
const sourceRepository = "https://github.com/MyHeavenDyf/UXAI.git"
const targetLabels: Record<BuildTarget, string> = {
  "mac-arm64": "macOS ARM64",
  "mac-x64": "macOS x64",
  "win-x64": "Windows x64",
}
function validBuildTarget(value: unknown): value is BuildTarget {
  return typeof value === "string" && Object.hasOwn(targetLabels, value)
}

const detectedTarget: BuildTarget =
  process.platform === "darwin" ? (process.arch === "arm64" ? "mac-arm64" : "mac-x64") : "win-x64"
if (Bun.env.BUILD_NODE_TARGET && !validBuildTarget(Bun.env.BUILD_NODE_TARGET)) {
  throw new Error(`BUILD_NODE_TARGET 配置错误: ${Bun.env.BUILD_NODE_TARGET}`)
}
const localTarget = validBuildTarget(Bun.env.BUILD_NODE_TARGET) ? Bun.env.BUILD_NODE_TARGET : detectedTarget
const workerEntries = (Bun.env.BUILD_WORKERS || "").split(",").filter(Boolean)
const workers = workerEntries
  .map((entry) => {
    const separator = entry.indexOf("=")
    const target = entry.slice(0, separator)
    const url = entry.slice(separator + 1).replace(/\/$/, "")
    return separator > 0 && validBuildTarget(target) && /^https?:\/\//.test(url) ? { target, url } : undefined
  })
  .filter((worker): worker is { target: BuildTarget; url: string } => Boolean(worker))
if (workers.length !== workerEntries.length || new Set(workers.map((worker) => worker.target)).size !== workers.length) {
  throw new Error("BUILD_WORKERS 配置错误，请使用 target=http://ip:port 并确保目标平台不重复")
}
const coordinator = workers.length > 0
const artifactsRoot = path.join(import.meta.dir, "artifacts")
const jobsFile = path.join(artifactsRoot, "jobs.json")
const retentionMs = 3 * 24 * 60 * 60 * 1000
const page = await Bun.file(path.join(import.meta.dir, "build_service.html")).text()
const runtimeDir = await mkdtemp(path.join(tmpdir(), "octo-build-service-"))
const automationScripts = [
  "run_all.sh",
  "download_git_zip.sh",
  "extract.sh",
  "copy_packages.sh",
  "version.sh",
  "build_desktop.sh",
]
await Promise.all(
  automationScripts.map((name) => Bun.write(path.join(runtimeDir, name), Bun.file(path.join(import.meta.dir, name)))),
)
const runner = path.join(runtimeDir, "run_all.sh")
const encoder = new TextEncoder()
const state = {
  jobs: [] as Job[],
  processing: false,
  subscribers: new Set<ReadableStreamDefaultController<Uint8Array>>(),
  remoteBranches: { branches: [] as string[], fetchedAt: 0 },
}
const persistence = { timer: undefined as ReturnType<typeof setTimeout> | undefined }
const serviceBranch = (await runCommand(["git", "branch", "--show-current"])).stdout

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } })
}

function publicJob(job: Job) {
  return {
    id: job.id,
    baseBranch: job.baseBranch,
    branch: job.branch,
    version: job.version,
    channel: job.channel,
    target: job.target,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    log: job.log,
    artifacts: job.artifacts,
  }
}

function sendEvent(type: string, value: unknown) {
  const message = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
  state.subscribers.forEach((subscriber) => {
    try {
      subscriber.enqueue(message)
    } catch {
      state.subscribers.delete(subscriber)
    }
  })
}

function updateJob(job: Job) {
  sendEvent("job", publicJob(job))
  schedulePersistJobs()
}

function appendLog(job: Job, text: string) {
  job.log = `${job.log}${text}`.slice(-400_000)
  sendEvent("log", { id: job.id, text })
}

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false
  const job = value as Record<string, unknown>
  return (
    typeof job.id === "string" &&
    /^[a-z0-9-]+$/.test(job.id) &&
    typeof job.baseBranch === "string" &&
    typeof job.branch === "string" &&
    typeof job.version === "string" &&
    (job.channel === "beta" || job.channel === "prod") &&
    (job.target === "mac-arm64" || job.target === "mac-x64" || job.target === "win-x64") &&
    (job.status === "queued" || job.status === "running" || job.status === "success" || job.status === "failed") &&
    typeof job.createdAt === "string" &&
    typeof job.log === "string" &&
    Array.isArray(job.artifacts)
  )
}

async function writeJobs() {
  await mkdir(artifactsRoot, { recursive: true })
  await Bun.write(jobsFile, `${JSON.stringify(state.jobs.map(publicJob), null, 2)}\n`)
}

function schedulePersistJobs() {
  if (persistence.timer) clearTimeout(persistence.timer)
  persistence.timer = setTimeout(() => {
    persistence.timer = undefined
    void writeJobs()
  }, 100)
}

async function loadJobs() {
  const stored = (await Bun.file(jobsFile).json().catch(() => [])) as unknown
  if (!Array.isArray(stored)) return
  state.jobs = stored
    .map((job) => job && typeof job === "object" && !("target" in job) ? { ...job, target: localTarget } : job)
    .filter(isJob)
    .map((job) => {
    if (job.status !== "queued" && job.status !== "running") return job
    return {
      ...job,
      status: "failed" as const,
      finishedAt: new Date().toISOString(),
      log: `${job.log}\n打包服务曾在任务执行期间停止，此任务已标记为失败。\n`,
    }
    })
}

async function workerRequest(target: BuildTarget, pathname: string, init?: RequestInit) {
  const worker = workers.find((candidate) => candidate.target === target)
  if (!worker) return undefined
  return fetch(`${worker.url}${pathname}`, { ...init, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
}

async function syncWorkers() {
  const results = await Promise.all(
    workers.map(async (worker) => {
      const response = await workerRequest(worker.target, "/api/state")
      if (!response?.ok) return state.jobs.filter((job) => job.target === worker.target)
      const value: unknown = await response.json().catch(() => undefined)
      if (!value || typeof value !== "object" || !("jobs" in value) || !Array.isArray(value.jobs)) {
        return state.jobs.filter((job) => job.target === worker.target)
      }
      return value.jobs.filter(isJob).map((job) => ({ ...job, target: worker.target }))
    }),
  )
  const jobs = results.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (JSON.stringify(jobs) === JSON.stringify(state.jobs)) return
  const previous = new Map(state.jobs.map((job) => [job.id, job]))
  const removed = state.jobs.some((job) => !jobs.some((candidate) => candidate.id === job.id))
  state.jobs = jobs
  if (removed) {
    sendEvent("snapshot", state.jobs.map(publicJob))
    return
  }
  jobs.forEach((job) => {
    const old = previous.get(job.id)
    if (!old) {
      sendEvent("job", publicJob(job))
      return
    }
    const metadataChanged =
      old.status !== job.status ||
      old.startedAt !== job.startedAt ||
      old.finishedAt !== job.finishedAt ||
      old.exitCode !== job.exitCode ||
      JSON.stringify(old.artifacts) !== JSON.stringify(job.artifacts)
    if (metadataChanged || !job.log.startsWith(old.log)) {
      sendEvent("job", publicJob(job))
      return
    }
    if (job.log !== old.log) sendEvent("log", { id: job.id, text: job.log.slice(old.log.length) })
  })
}

async function purgeExpiredJobs() {
  const cutoff = Date.now() - retentionMs
  const expired = state.jobs.filter((job) => new Date(job.createdAt).getTime() < cutoff)
  state.jobs = state.jobs.filter((job) => new Date(job.createdAt).getTime() >= cutoff)
  await Promise.all(expired.map((job) => rm(path.join(artifactsRoot, job.id), { recursive: true, force: true })))
  if (expired.length) {
    await writeJobs()
    sendEvent("snapshot", state.jobs.map(publicJob))
  }
}

async function runCommand(command: string[]) {
  const process = Bun.spawn(command, { cwd: rootDir, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function gitState() {
  const [branch, branches, changes] = await Promise.all([
    runCommand(["git", "branch", "--show-current"]),
    runCommand(["git", "branch", "--format=%(refname:short)"]),
    runCommand(["git", "status", "--porcelain"]),
  ])
  const changeLines = changes.stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("?? packaging_shell/"))
  return {
    current: branch.stdout || "(detached HEAD)",
    branches: branches.stdout.split("\n").filter(Boolean),
    dirty: changeLines.length > 0,
    changes: changeLines.slice(0, 30),
  }
}

function proxyConfigValue(content: string, key: string) {
  const line = content
    .split("\n")
    .map((value) => value.trim())
    .find((value) => new RegExp(`^(?:export\\s+)?${key}\\s*=`).test(value))
  if (!line) return ""
  const value = line.slice(line.indexOf("=") + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

async function proxyProcessEnv() {
  const configured = Bun.env.PACKAGING_PROXY_ENV_FILE
  const primary = configured || path.join(rootDir, ".env.proxy")
  const fallback = path.join(rootDir, "merge-option", ".env.proxy")
  const file = !configured && !(await Bun.file(primary).exists()) && (await Bun.file(fallback).exists()) ? fallback : primary
  if (!(await Bun.file(file).exists())) return { error: `未找到代理配置文件: ${file}` }
  const content = await Bun.file(file).text()
  const user = proxyConfigValue(content, "HW_USER")
  const password = proxyConfigValue(content, "HW_PASS")
  if (!user || !password) return { error: `${file} 中缺少 HW_USER 或 HW_PASS` }
  const host = proxyConfigValue(content, "HW_PROXY_HOST") || "proxyhk.huawei.com:8080"
  const proxy = `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}`
  const env = processEnv()
  env.http_proxy = proxy
  env.https_proxy = proxy
  env.HTTP_PROXY = proxy
  env.HTTPS_PROXY = proxy
  env.NO_PROXY = "localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com"
  env.no_proxy = env.NO_PROXY
  env.GIT_TERMINAL_PROMPT = "0"
  return { env }
}

async function remoteBranches(force = false) {
  if (!force && state.remoteBranches.branches.length && Date.now() - state.remoteBranches.fetchedAt < 60_000) {
    return { branches: state.remoteBranches.branches, fetchedAt: state.remoteBranches.fetchedAt }
  }

  const proxy = await proxyProcessEnv()
  if ("error" in proxy) return { error: proxy.error }
  const subprocess = Bun.spawn(
    [
      "git",
      "-c",
      "http.sslVerify=false",
      "-c",
      "http.proxyAuthMethod=basic",
      "ls-remote",
      "--heads",
      sourceRepository,
    ],
    {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
      env: proxy.env,
    },
  )
  const completion = Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ timedOut: false as const, stdout, stderr, exitCode }))
  const timeout = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  const result = await Promise.race([
    completion,
    new Promise<{ timedOut: true }>((resolve) => {
      timeout.id = setTimeout(() => {
        subprocess.kill(9)
        resolve({ timedOut: true })
      }, 20_000)
    }),
  ])
  if (timeout.id) clearTimeout(timeout.id)
  if (result.timedOut) {
    if (state.remoteBranches.branches.length) {
      return {
        branches: state.remoteBranches.branches,
        fetchedAt: state.remoteBranches.fetchedAt,
        warning: "固定仓库连接超时，当前显示上次成功获取的分支列表",
      }
    }
    return { error: `连接 ${sourceRepository} 超时` }
  }
  if (result.exitCode !== 0) return { error: result.stderr.trim() || `无法读取 ${sourceRepository} 的分支` }

  state.remoteBranches = {
    branches: result.stdout
      .split("\n")
      .map((line) => line.split("\trefs/heads/")[1])
      .filter((branch): branch is string => Boolean(branch))
      .sort((a, b) => a.localeCompare(b)),
    fetchedAt: Date.now(),
  }
  return { branches: state.remoteBranches.branches, fetchedAt: state.remoteBranches.fetchedAt }
}

async function copyArtifacts(job: Job) {
  const dist = path.join(rootDir, "packages", "desktop", "dist")
  const output = path.join(artifactsRoot, job.id)
  await mkdir(output, { recursive: true })

  const walk = async (dir: string): Promise<string[]> =>
    readdir(dir, { withFileTypes: true })
      .then((entries) =>
        Promise.all(
          entries.map((entry) => {
            const target = path.join(dir, entry.name)
            return entry.isDirectory() ? walk(target) : Promise.resolve([target])
          }),
        ),
      )
      .then((entries) => entries.flat())
      .catch(() => [])

  const files = (await walk(dist)).filter((file) =>
    [".dmg", ".zip", ".exe", ".appimage", ".deb", ".rpm", ".yml", ".yaml", ".blockmap"].includes(
      path.extname(file).toLowerCase(),
    ),
  )

  job.artifacts = await Promise.all(
    files.map(async (file) => {
      const name = path.relative(dist, file).split(path.sep).join("__")
      await Bun.write(path.join(output, name), Bun.file(file))
      return { name, size: Bun.file(file).size }
    }),
  )
}

async function streamToLog(job: Job, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const read = async (): Promise<void> => {
    const chunk = await reader.read()
    if (chunk.done) {
      const remaining = decoder.decode()
      if (remaining) appendLog(job, remaining)
      return
    }
    appendLog(job, decoder.decode(chunk.value, { stream: true }))
    return read()
  }
  await read()
}

async function runJob(job: Job) {
  job.status = "running"
  job.startedAt = new Date().toISOString()
  appendLog(
    job,
    `开始任务 ${job.id}\n目标平台: ${targetLabels[job.target]}\n基础代码分支: ${job.baseBranch}\n下载分支: ${job.branch}\n版本: ${job.version}\n构建环境: ${job.channel}\n\n`,
  )
  updateJob(job)

  const before = await gitState()
  if (before.dirty) {
    job.status = "failed"
    job.finishedAt = new Date().toISOString()
    appendLog(job, "工作区存在任务外的未提交修改。为避免误删代码，本次任务已终止。\n")
    updateJob(job)
    return
  }

  const switched = await runCommand(["git", "switch", job.baseBranch])
  if (switched.exitCode !== 0) {
    job.status = "failed"
    job.finishedAt = new Date().toISOString()
    appendLog(job, `切换基础代码分支失败: ${switched.stderr || switched.stdout}\n`)
    updateJob(job)
    return
  }
  appendLog(job, `已切换到基础代码分支 ${job.baseBranch}\n\n`)
  sendEvent("git", await gitState())

  const env = processEnv()
  env.PACKAGING_PROJECT_ROOT = rootDir
  env.PACKAGING_SCRIPT_DIR = runtimeDir
  env.PACKAGING_DATA_DIR = import.meta.dir
  const process = Bun.spawn(
    [
      "bash",
      runner,
      "--branch",
      job.branch,
      "--version",
      job.version,
      "--channel",
      job.channel,
      "--target",
      job.target,
    ],
    { cwd: rootDir, stdout: "pipe", stderr: "pipe", env },
  )
  await Promise.all([streamToLog(job, process.stdout), streamToLog(job, process.stderr)])
  job.exitCode = await process.exited

  if (job.exitCode === 0) await copyArtifacts(job)

  appendLog(job, "\n正在清除本次打包产生的 Git 改动...\n")
  const reset = await runCommand(["git", "reset", "--hard", "HEAD"])
  if (reset.stdout) appendLog(job, `${reset.stdout}\n`)
  if (reset.stderr) appendLog(job, `${reset.stderr}\n`)
  const clean = await runCommand(["git", "clean", "-fd", "-e", "packaging_shell/"])
  if (clean.stdout) appendLog(job, `${clean.stdout}\n`)
  if (clean.stderr) appendLog(job, `${clean.stderr}\n`)
  sendEvent("git", await gitState())

  job.finishedAt = new Date().toISOString()
  if (reset.exitCode !== 0 || clean.exitCode !== 0) {
    job.status = "failed"
    appendLog(job, "Git 改动清理失败，请管理员检查打包机工作区。\n")
    updateJob(job)
    return
  }

  if (job.exitCode !== 0) {
    job.status = "failed"
    appendLog(job, `Git 改动已清除。任务失败，退出码: ${job.exitCode}\n`)
    updateJob(job)
    return
  }

  job.status = "success"
  appendLog(job, `Git 改动已清除。任务完成，共收集 ${job.artifacts.length} 个产物。\n`)
  updateJob(job)
}

function processEnv() {
  const env = { ...Bun.env }
  ;[
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
    "npm_config_proxy",
    "npm_config_https_proxy",
    "NPM_CONFIG_PROXY",
    "NPM_CONFIG_HTTPS_PROXY",
    "NODE_TLS_REJECT_UNAUTHORIZED",
  ].forEach((key) => delete env[key])
  env.NO_PROXY = "*"
  env.no_proxy = "*"
  return env
}

async function processQueue() {
  if (state.processing) return
  const job = state.jobs.find((candidate) => candidate.status === "queued")
  if (!job) {
    const current = await gitState()
    if (serviceBranch && !current.dirty && current.current !== serviceBranch) {
      await runCommand(["git", "switch", serviceBranch])
      sendEvent("git", await gitState())
    }
    return
  }
  state.processing = true
  await runJob(job).catch((error: unknown) => {
    job.status = "failed"
    job.finishedAt = new Date().toISOString()
    appendLog(job, `\n服务异常: ${error instanceof Error ? error.message : String(error)}\n`)
    updateJob(job)
  })
  state.processing = false
  void processQueue()
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return !origin || origin === new URL(request.url).origin
}

function validBranch(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(value) &&
    !value.includes("..") &&
    !value.includes("//")
  )
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(value)
}

async function createJob(request: Request) {
  if (!sameOrigin(request)) return json({ error: "不允许跨站提交任务" }, 403)
  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
  if (!body || !validBuildTarget(body.target)) {
    return json({ error: "请选择有效的目标平台" }, 400)
  }
  if (coordinator) {
    const response = await workerRequest(body.target, "/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response) return json({ error: `${targetLabels[body.target]} 构建机无法连接` }, 503)
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    })
  }
  if (body.target !== localTarget) {
    return json({ error: `此构建机只接受 ${targetLabels[localTarget]} 任务` }, 409)
  }
  if (state.jobs.filter((job) => job.status === "running" || job.status === "queued").length >= 20) {
    return json({ error: "当前队列已满，请等待已有任务完成" }, 429)
  }
  if (!validBranch(body.branch)) return json({ error: "分支名称不合法" }, 400)
  if (state.remoteBranches.branches.length && !state.remoteBranches.branches.includes(body.branch)) {
    return json({ error: "请选择 Git 远端当前存在的分支" }, 400)
  }
  if (!validBranch(body.baseBranch)) return json({ error: "基础代码分支不合法" }, 400)
  if (!(await gitState()).branches.includes(body.baseBranch)) {
    return json({ error: "请选择打包机当前存在的本地基础分支" }, 400)
  }
  if (!validVersion(body.version)) return json({ error: "版本号必须符合 SemVer，例如 0.3.11" }, 400)
  if (body.channel !== "beta" && body.channel !== "prod") {
    return json({ error: "构建环境仅支持 beta 或 prod" }, 400)
  }

  const job: Job = {
    id: `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    baseBranch: body.baseBranch,
    branch: body.branch,
    version: body.version,
    channel: body.channel,
    target: body.target,
    status: "queued",
    createdAt: new Date().toISOString(),
    log: "",
    artifacts: [],
  }
  state.jobs.unshift(job)
  updateJob(job)
  void processQueue()
  return json({ job: publicJob(job) }, 202)
}

async function switchBranch(request: Request) {
  if (!sameOrigin(request)) return json({ error: "不允许跨站切换分支" }, 403)
  if (state.jobs.some((job) => job.status === "running" || job.status === "queued")) {
    return json({ error: "存在运行中或排队中的任务，暂时不能切换分支" }, 409)
  }

  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
  if (!body || !validBranch(body.branch)) return json({ error: "分支名称不合法" }, 400)
  const current = await gitState()
  if (current.dirty) return json({ error: "工作区存在未提交修改，为避免丢失代码，已拒绝切换", git: current }, 409)
  if (!current.branches.includes(body.branch)) return json({ error: "只能切换到已经存在的本地分支" }, 404)

  const result = await runCommand(["git", "switch", body.branch])
  if (result.exitCode !== 0) return json({ error: result.stderr || result.stdout || "切换失败" }, 500)
  const git = await gitState()
  sendEvent("git", git)
  return json({ git })
}

async function artifactResponse(url: URL) {
  const match = url.pathname.match(/^\/api\/artifacts\/([a-z0-9-]+)\/([^/]+)$/)
  if (!match) return json({ error: "产物不存在" }, 404)
  const job = state.jobs.find((candidate) => candidate.id === match[1])
  const name = decodeURIComponent(match[2])
  if (!job?.artifacts.some((artifact) => artifact.name === name)) return json({ error: "产物不存在" }, 404)
  if (coordinator) {
    const response = await workerRequest(job.target, url.pathname)
    if (!response?.ok) return json({ error: "无法从构建机读取产物" }, response?.status || 502)
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/octet-stream",
        "content-disposition": response.headers.get("content-disposition") || "attachment",
      },
    })
  }
  const file = Bun.file(path.join(artifactsRoot, job.id, name))
  if (!file.size) return json({ error: "产物文件不存在" }, 404)
  return new Response(file, {
    headers: {
      "content-type": file.type || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  })
}

const port = Number(Bun.env.BUILD_SERVICE_PORT || 8787)
const hostname = Bun.env.BUILD_SERVICE_HOST || "0.0.0.0"
if (coordinator) {
  await syncWorkers()
  setInterval(() => void syncWorkers(), 1_000)
} else {
  await loadJobs()
  await purgeExpiredJobs()
  setInterval(() => void purgeExpiredJobs(), 60 * 60 * 1000)
}
const server = Bun.serve({
  port,
  hostname,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json({ jobs: state.jobs.map(publicJob), processing: state.processing, coordinator })
    }
    if (request.method === "GET" && url.pathname === "/api/targets") {
      return json({
        targets: (coordinator ? workers.map((worker) => worker.target) : [localTarget]).map((target) => ({
          value: target,
          label: targetLabels[target],
        })),
      })
    }
    if (request.method === "GET" && url.pathname === "/api/git") {
      if (!coordinator) return json({ git: await gitState() })
      const target = url.searchParams.get("target")
      if (!validBuildTarget(target)) return json({ error: "请选择目标平台" }, 400)
      const response = await workerRequest(target, "/api/git")
      if (!response) return json({ error: `${targetLabels[target]} 构建机无法连接` }, 503)
      return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } })
    }
    if (request.method === "GET" && url.pathname === "/api/git/remote-branches") {
      const result = await remoteBranches(url.searchParams.get("refresh") === "1")
      if ("error" in result) return json(result, result.error.includes("超时") ? 504 : 502)
      return json({ ...result, repository: sourceRepository })
    }
    if (request.method === "POST" && url.pathname === "/api/git/switch") {
      if (!coordinator) return switchBranch(request)
      const target = url.searchParams.get("target")
      if (!validBuildTarget(target)) return json({ error: "请选择目标平台" }, 400)
      const response = await workerRequest(target, "/api/git/switch", {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") || "application/json" },
        body: await request.text(),
      })
      if (!response) return json({ error: `${targetLabels[target]} 构建机无法连接` }, 503)
      return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } })
    }
    if (request.method === "POST" && url.pathname === "/api/jobs") return createJob(request)
    if (request.method === "GET" && url.pathname === "/api/events") {
      let controller: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
          state.subscribers.add(value)
          value.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(state.jobs.map(publicJob))}\n\n`))
        },
        cancel() {
          state.subscribers.delete(controller)
        },
      })
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/artifacts/")) return artifactResponse(url)
    return json({ error: "Not Found" }, 404)
  },
})

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === "IPv4" && !address.internal)
  .map((address) => `http://${address?.address}:${server.port}`)

console.log(`Octo 内网打包服务已启动（${coordinator ? "主控" : targetLabels[localTarget]}）：`)
console.log(`  本机：http://127.0.0.1:${server.port}`)
addresses.forEach((address) => console.log(`  内网：${address}`))
