// Preview only: the complete output must still pass parseExpansion/validateExpansion.
export function createExpandedPromptReader() {
  const stack: { object: boolean; phase: "key" | "colon" | "value" | "after"; key?: string }[] = []
  const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }
  let started = false
  let stopped = false
  let seen = false
  let role: "key" | "target" | "skip" | undefined
  let key = ""
  let escaped = false
  let unicode: string | undefined
  let high = ""
  let primitive = ""
  let count = 0

  return {
    push(input: string) {
      let delta = ""
      const commit = (value: string) => {
        if (count >= 1000) return
        delta += value
        count++
      }
      const emit = (value: string) => {
        if (role === "key") { key += value; return }
        if (role !== "target") return
        const code = value.charCodeAt(0)
        if (high) {
          if (code >= 0xdc00 && code <= 0xdfff) {
            commit(high + value)
            high = ""
            return
          }
          commit(high)
          high = ""
        }
        if (code >= 0xd800 && code <= 0xdbff) { high = value; return }
        commit(value)
      }

      for (const char of input) {
        if (stopped) break
        if (role) {
          if (unicode !== undefined) {
            if (!/^[\da-f]$/i.test(char)) { stopped = true; continue }
            unicode += char
            if (unicode.length === 4) {
              emit(String.fromCharCode(Number.parseInt(unicode, 16)))
              unicode = undefined
            }
            continue
          }
          if (escaped) {
            escaped = false
            if (char === "u") { unicode = ""; continue }
            if (!(char in escapes)) { stopped = true; continue }
            emit(escapes[char])
            continue
          }
          if (char === "\\") { escaped = true; continue }
          if (char === '"') {
            if (role === "key") {
              const frame = stack[stack.length - 1]
              frame.key = key
              frame.phase = "colon"
              if (stack.length === 1 && key === "expandedPrompt") {
                if (seen) stopped = true
                seen = true
              }
            }
            if (high) { commit(high); high = "" }
            role = undefined
            continue
          }
          if (char.charCodeAt(0) < 0x20) { stopped = true; continue }
          // for..of may yield a full literal surrogate pair in one chunk.
          if (char.length === 2) { emit(char[0]); emit(char[1]); continue }
          emit(char)
          continue
        }

        if (!started) {
          if (char !== "{") continue
          started = true
          stack.push({ object: true, phase: "key" })
          continue
        }
        if (primitive) {
          if (!/[\s,}\]]/.test(char)) { primitive += char; continue }
          if (!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(primitive)) {
            stopped = true
            continue
          }
          primitive = ""
        }
        if (/\s/.test(char)) continue
        const frame = stack[stack.length - 1]
        if (!frame) { if (char === "{") stopped = true; continue }
        if (char === "}" || char === "]") {
          if (frame.object !== (char === "}") || frame.phase === "colon") { stopped = true; continue }
          stack.pop()
          continue
        }
        if (frame.phase === "after") {
          if (char !== ",") { stopped = true; continue }
          frame.phase = frame.object ? "key" : "value"
          frame.key = undefined
          continue
        }
        if (frame.phase === "colon") {
          if (char !== ":") { stopped = true; continue }
          frame.phase = "value"
          continue
        }
        if (frame.phase === "key") {
          if (char !== '"') { stopped = true; continue }
          key = ""
          role = "key"
          continue
        }
        const target = stack.length === 1 && frame.key === "expandedPrompt"
        frame.phase = "after"
        if (target && char !== '"') { stopped = true; continue }
        if (char === '"') { role = target ? "target" : "skip"; continue }
        if (char === "{" || char === "[") {
          stack.push({ object: char === "{", phase: char === "{" ? "key" : "value" })
          continue
        }
        primitive = char
      }
      return delta
    },
  }
}
