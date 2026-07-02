/**
 * Debug 日志收集 — 内存累积 agent 调用日志，管线结束后注入版本 JSON。
 */

export type LogEntry = {
  idx: number
  ts: number
  agent: string
  sessionId: string
  input: unknown
  output: unknown
  parsed: unknown
}

export type SessionDebugLog = {
  sessionId: string
  userInput: string
  startedAt: number
  entries: LogEntry[]
}

let _current: SessionDebugLog | null = null
let _entryIdx = 0
const _sessionIdxMap = new Map<string, number>()

export function logStartSession(sessionId: string, userInput: string) {
  if (_current?.sessionId === sessionId) return
  _current = {
    sessionId,
    userInput,
    startedAt: Date.now(),
    entries: [],
  }
  _entryIdx = 0
  _sessionIdxMap.clear()
}

export function logAgentCall(agent: string, sessionId: string, input: unknown, output: unknown) {
  if (!_current) return
  const idx = ++_entryIdx
  _current.entries.push({ idx, ts: Date.now(), agent, sessionId, input, output, parsed: null })
  _sessionIdxMap.set(sessionId, idx)
}

export function logAgentParsed(sessionId: string, parsed: unknown) {
  if (!_current) return
  const idx = _sessionIdxMap.get(sessionId)
  if (!idx) return
  const entry = _current.entries.find((e) => e.idx === idx)
  if (entry) {
    entry.parsed = parsed
  }
}

export function getDebugSnapshot(): SessionDebugLog | null {
  return _current ? { ..._current, entries: [..._current.entries] } : null
}

export function clearDebugLog() {
  _current = null
  _entryIdx = 0
  _sessionIdxMap.clear()
}

import { getDesktopApi } from "./desktop-api"

export type DebugPhase = "intent_confirm" | "planner" | "modules" | "modify" | "modify_triage" | "modify_planner" | "create" | "error"

const DEBUG_LOG_PREFIX = "octo:pattern:debug-log"

export async function saveDebugSnapshot(
  historyDir: string,
  sessionId: string,
  phase: DebugPhase,
  opts?: {
    error?: string
    lastIntent?: Record<string, unknown> | null
    lastPlanner?: Record<string, unknown> | null
    lastModules?: Array<Record<string, unknown>>
    mergedA2UI?: Record<string, unknown>
    summary?: string
    extra?: Record<string, unknown>
  },
): Promise<void> {
  const api = getDesktopApi()
  const snapshot = getDebugSnapshot()
  const baseDir = historyDir.replace(/\/history$/, "")
  const fid = _current?.startedAt ?? Date.now()
  const path = `${baseDir}/debug-log/${sessionId}/${fid}.json`

  let entries: Array<Record<string, unknown>> = []
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (buf) entries = JSON.parse(new TextDecoder().decode(buf))
    } catch {}
  } else {
    const stored = localStorage.getItem(`${DEBUG_LOG_PREFIX}:${sessionId}:${fid}`)
    if (stored) {
      try { entries = JSON.parse(stored) } catch {}
    }
  }

  const entry: Record<string, unknown> = {
    phase,
    savedAt: Date.now(),
    debug: snapshot,
  }
  if (opts?.error !== undefined) entry.error = opts.error
  if (opts?.extra !== undefined) entry.extra = opts.extra
  if (opts?.summary !== undefined) entry.summary = opts.summary
  if (opts?.lastIntent !== undefined) entry.lastIntent = opts.lastIntent
  if (opts?.lastPlanner !== undefined) entry.lastPlanner = opts.lastPlanner
  if (opts?.lastModules !== undefined) entry.lastModules = opts.lastModules
  if (opts?.mergedA2UI !== undefined) entry.mergedA2UI = opts.mergedA2UI

  entries.push(entry)
  const payload = JSON.stringify(entries, null, 2)

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${DEBUG_LOG_PREFIX}:${sessionId}:${fid}`, payload)
}
