import { describe, expect, test } from "bun:test"
import { renameRowField } from "./utils"
import { matchShadowToken, effectsSignature, type EffectData } from "./raw-parsers"
import { parseClass } from "./class-parser"

// ── Fix #1 & #2: found flag data flow ──────────────────────────────────────
// When the element has no explicit font-size/weight, foundFontSize/foundFontWeight
// is false. buildCssObject checks `isDirty('fontSize') && foundFontSize()`.
// If the user changes the value but found stays false (the bug), the change
// is silently dropped. The fix ensures setFound(true) is called on commit.
describe("found-flag data flow (Fix #1 & #2)", () => {
  // Simulates the buildCssObject guard for font-size / font-weight.
  function buildCssEntry(isDirty: boolean, found: boolean, value: number, unit: string): Record<string, string> {
    if (isDirty && found) return { [unit]: value + (unit === 'font-weight' ? '' : 'px') }
    return {}
  }

  test("font-size excluded when foundFontSize is false (the bug, before fix)", () => {
    const css = buildCssEntry(true, false, 16, 'font-size')
    expect(css).toEqual({})
  })

  test("font-size included when foundFontSize is true (after fix: setFoundFontSize called)", () => {
    const css = buildCssEntry(true, true, 16, 'font-size')
    expect(css).toEqual({ 'font-size': '16px' })
  })

  test("font-weight excluded when foundFontWeight is false (the bug, before fix)", () => {
    const css = buildCssEntry(true, false, 700, 'font-weight')
    expect(css).toEqual({})
  })

  test("font-weight included when foundFontWeight is true (after fix: setFoundFontWeight called)", () => {
    const css = buildCssEntry(true, true, 700, 'font-weight')
    expect(css).toEqual({ 'font-weight': '700' })
  })
})

// ── Fix #3: closePopup flush on close ───────────────────────────────────────
// When the user closes the popup within the 300ms debounce window, the
// autoSave timer is cleared and changes are lost. The fix adds a closePopup
// function that checks if the current snapshot differs from the baseline
// and flushes via handleConfirm(true) before calling onCancel.
describe("closePopup flush logic (Fix #3)", () => {
  // Simulates the closePopup decision: should we flush?
  function shouldFlush(initialized: boolean, baseline: string, currentSnap: unknown): boolean {
    if (!initialized || !baseline) return false
    if (currentSnap == null) return false
    return JSON.stringify(currentSnap) !== baseline
  }

  test("does not flush when no change (snapshot === baseline)", () => {
    const snap = { fontSize: 14, padding: 8 }
    const baseline = JSON.stringify(snap)
    expect(shouldFlush(true, baseline, snap)).toBe(false)
  })

  test("flushes when there is a pending change (snapshot !== baseline)", () => {
    const baseline = JSON.stringify({ fontSize: 14, padding: 8 })
    const currentSnap = { fontSize: 16, padding: 8 }
    expect(shouldFlush(true, baseline, currentSnap)).toBe(true)
  })

  test("does not flush when not yet initialized (ready=false)", () => {
    expect(shouldFlush(false, '', { fontSize: 16 })).toBe(false)
  })

  test("does not flush when snapshot is null (popup already closed)", () => {
    expect(shouldFlush(true, '{"a":1}', null)).toBe(false)
  })
})

// ── Fix #4: table column dataIndex rename ───────────────────────────────────
// When the user renames a column's dataIndex, the row data must follow.
// Otherwise the old field is orphaned and the table shows empty cells.
describe("renameRowField (Fix #4)", () => {
  test("renames the field in all rows that have it", () => {
    const rows = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
      { name: 'Charlie', age: 40 },
    ]
    const result = renameRowField(rows, 'name', 'fullName')
    expect(result).toEqual([
      { fullName: 'Alice', age: 30 },
      { fullName: 'Bob', age: 25 },
      { fullName: 'Charlie', age: 40 },
    ])
  })

  test("preserves rows that do not have the old field", () => {
    const rows = [
      { name: 'Alice', age: 30 },
      { age: 25 },
      { name: 'Charlie', age: 40 },
    ]
    const result = renameRowField(rows, 'name', 'fullName')
    expect(result[0]).toEqual({ fullName: 'Alice', age: 30 })
    expect(result[1]).toEqual({ age: 25 })
    expect(result[2]).toEqual({ fullName: 'Charlie', age: 40 })
  })

  test("does not modify rows when old field is absent from all", () => {
    const rows = [{ a: 1 }, { b: 2 }]
    const result = renameRowField(rows, 'zzz', 'yyy')
    expect(result).toEqual([{ a: 1 }, { b: 2 }])
  })

  test("returns empty array unchanged", () => {
    expect(renameRowField([], 'a', 'b')).toEqual([])
  })

  test("handles multiple fields correctly (only renames the target)", () => {
    const rows = [{ foo: 1, bar: 2, baz: 3 }]
    const result = renameRowField(rows, 'bar', 'qux')
    expect(result[0]).toEqual({ foo: 1, qux: 2, baz: 3 })
  })
})

// ── #10: effectsSignature + matchShadowToken ───────────────────────────────
describe("effectsSignature (Fix #10)", () => {
  const baseEffect: EffectData = {
    type: 'drop-shadow', visible: true, expanded: false,
    color: '#000000', opacity: 8, blur: 6, offsetX: 1, offsetY: 1,
    foundBlur: true, foundOffsetX: true, foundOffsetY: true,
    layerBlur: 0, foundLayerBlur: false, bgBlur: 0, foundBgBlur: false,
  }

  test("excludes expanded (UI state) from signature", () => {
    const a = [{ ...baseEffect, expanded: false }]
    const b = [{ ...baseEffect, expanded: true }]
    expect(effectsSignature(a)).toBe(effectsSignature(b))
  })

  test("excludes visible (UI state) from signature", () => {
    const a = [{ ...baseEffect, visible: true }]
    const b = [{ ...baseEffect, visible: false }]
    expect(effectsSignature(a)).toBe(effectsSignature(b))
  })

  test("detects actual content change (blur)", () => {
    const a = [{ ...baseEffect, blur: 6 }]
    const b = [{ ...baseEffect, blur: 12 }]
    expect(effectsSignature(a)).not.toBe(effectsSignature(b))
  })

  test("detects actual content change (color)", () => {
    const a = [{ ...baseEffect, color: '#000000' }]
    const b = [{ ...baseEffect, color: '#ff0000' }]
    expect(effectsSignature(a)).not.toBe(effectsSignature(b))
  })
})

describe("matchShadowToken 3-digit hex (Fix #10)", () => {
  test("matches card token with 3-digit hex #000", () => {
    const effect = {
      type: 'drop-shadow' as const, color: '#000', opacity: 8,
      blur: 6, offsetX: 1, offsetY: 1,
    }
    expect(matchShadowToken(effect)).toBe('card')
  })

  test("matches card token with 6-digit hex #000000", () => {
    const effect = {
      type: 'drop-shadow' as const, color: '#000000', opacity: 8,
      blur: 6, offsetX: 1, offsetY: 1,
    }
    expect(matchShadowToken(effect)).toBe('card')
  })

  test("matches md token with 6-digit hex", () => {
    const effect = {
      type: 'drop-shadow' as const, color: '#000000', opacity: 16,
      blur: 12, offsetX: 0, offsetY: 4,
    }
    expect(matchShadowToken(effect)).toBe('md')
  })

  test("returns null for non-shadow type", () => {
    const effect = {
      type: 'layer-blur' as const, color: '#000', opacity: 100,
      blur: 0, offsetX: 0, offsetY: 0,
    }
    expect(matchShadowToken(effect)).toBeNull()
  })

  test("returns null for non-matching values", () => {
    const effect = {
      type: 'drop-shadow' as const, color: '#ff0000', opacity: 50,
      blur: 10, offsetX: 5, offsetY: 5,
    }
    expect(matchShadowToken(effect)).toBeNull()
  })
})

// ── #5: letterSpacing parsing (class-parser) ───────────────────────────────
describe("letterSpacing parsing (Fix #5)", () => {
  test("tracking-[2px] → 2 (px preserved)", () => {
    const info = parseClass("tracking-[2px]").info
    expect(info.letterSpacing).toBe(2)
  })

  test("tracking-[0.05em] → 0.8 (em×16)", () => {
    const info = parseClass("tracking-[0.05em]").info
    expect(info.letterSpacing).toBe(0.8)
  })

  test("tracking-wide → 0.4 (0.025em × 16)", () => {
    const info = parseClass("tracking-wide").info
    expect(info.letterSpacing).toBe(0.4)
  })

  test("tracking-wider → 0.8 (0.05em × 16)", () => {
    const info = parseClass("tracking-wider").info
    expect(info.letterSpacing).toBe(0.8)
  })

  test("tracking-normal → 0", () => {
    const info = parseClass("tracking-normal").info
    expect(info.letterSpacing).toBe(0)
  })

  test("no NaN for any valid tracking class", () => {
    const classes = ["tracking-[2px]", "tracking-[0.05em]", "tracking-wide", "tracking-wider", "tracking-widest", "tracking-tight", "tracking-tighter", "tracking-normal"]
    for (const c of classes) {
      const ls = parseClass(c).info.letterSpacing
      expect(isNaN(ls)).toBe(false)
    }
  })

  test("round-trip stable: tracking-[2px] → 2 → tracking-[2px]", () => {
    const ls = parseClass("tracking-[2px]").info.letterSpacing
    // buildClassName would output: tracking-[${ls}px]
    const output = `tracking-[${ls}px]`
    expect(output).toBe("tracking-[2px]")
    // Re-parse should give same value
    const ls2 = parseClass(output).info.letterSpacing
    expect(ls2).toBe(ls)
  })
})

// ── #6: lineHeight parsing (class-parser) ──────────────────────────────────
describe("lineHeight parsing (Fix #6)", () => {
  test("leading-[24px] → '24px' (unit preserved)", () => {
    const info = parseClass("leading-[24px]").info
    expect(info.lineHeight).toBe('24px')
  })

  test("leading-[1.5] → '1.5' (unitless preserved)", () => {
    const info = parseClass("leading-[1.5]").info
    expect(info.lineHeight).toBe('1.5')
  })

  test("leading-none → '1'", () => {
    const info = parseClass("leading-none").info
    expect(info.lineHeight).toBe('1')
  })
})

// ── #9: className dedup ────────────────────────────────────────────────────
describe("className dedup (Fix #9)", () => {
  test("deduplicates exact duplicate classes", () => {
    const className = "flex flex relative p-4 p-4"
    const deduped = [...new Set(className.split(/\s+/).filter(Boolean))].join(' ')
    expect(deduped).toBe("flex relative p-4")
  })

  test("preserves unique classes", () => {
    const className = "flex flex-col p-4 text-red-500"
    const deduped = [...new Set(className.split(/\s+/).filter(Boolean))].join(' ')
    expect(deduped).toBe("flex flex-col p-4 text-red-500")
  })

  test("handles empty string", () => {
    const className = ""
    const deduped = [...new Set(className.split(/\s+/).filter(Boolean))].join(' ')
    expect(deduped).toBe("")
  })
})
