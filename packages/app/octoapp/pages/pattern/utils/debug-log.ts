/**
 * Debug 日志收集 — 内存累积 agent 调用日志，管线结束后注入版本 JSON。
 */

export type LogEntry = {
  idx: number
  ts: number
  agent: string
  sessionId: string
  input: string
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
  _current = {
    sessionId,
    userInput,
    startedAt: Date.now(),
    entries: [],
  }
  _entryIdx = 0
  _sessionIdxMap.clear()
}

export function logAgentCall(agent: string, sessionId: string, input: string, output: unknown) {
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

export type DebugLogState = {
  lastIntent: Record<string, unknown> | null
  lastPlanner: Record<string, unknown> | null
  lastModules: Array<Record<string, unknown>>
  mergedA2UI?: Record<string, unknown>
  debug: SessionDebugLog | null
}

const DEBUG_LOG_PREFIX = "octo:pattern:debug-log"

function sanitizeFilename(summary: string): string {
  return summary
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
}

export async function saveDebugLog(
  historyDir: string,
  sessionId: string,
  state: DebugLogState,
  summary: string,
): Promise<void> {
  const api = getDesktopApi()
  const now = Date.now()
  const filename = `${now}-${sanitizeFilename(summary)}.json`
  const payload = JSON.stringify({ ...state, savedAt: now, summary }, null, 2)

  const baseDir = historyDir.replace(/\/history$/, "")
  const path = `${baseDir}/debug-log/${sessionId}/${filename}`
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${DEBUG_LOG_PREFIX}:${sessionId}:${filename}`, payload)
}
