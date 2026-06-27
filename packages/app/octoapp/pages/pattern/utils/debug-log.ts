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
