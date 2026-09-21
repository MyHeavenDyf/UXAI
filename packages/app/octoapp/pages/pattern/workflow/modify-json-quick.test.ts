import { describe, expect, test } from "bun:test"
import { handleModifyElement, type QuickModifyContext, type ModifyElementData } from "./modify-json-quick"

function makeCtx(doc: unknown): { ctx: QuickModifyContext; getDoc: () => unknown } {
  let sent: unknown
  const ctx: QuickModifyContext = {
    getPendingData: () => doc,
    sendToPreview: (d) => { sent = d },
    refreshPreview: () => {},
    getHistoryDir: () => '/tmp/test',
    getSessionId: () => 'test-session',
    getLastIntent: () => null,
    getLastPlanner: () => null,
    getLastModules: () => [],
    setVersions: () => {},
    setCurrentVersionId: () => {},
  }
  return { ctx, getDoc: () => sent }
}

function makeData(overrides: Partial<ModifyElementData> = {}): ModifyElementData {
  return {
    elementId: 'el-1',
    className: '',
    textContent: '',
    componentProps: {},
    saveToHistory: false,
    ...overrides,
  }
}

describe("modify-json-quick text clearing (Fix #2)", () => {
  test("clears text when original value is a non-empty string", async () => {
    const doc = { elements: [{ id: 'el-1', props: { value: 'Hello', className: 'p-4' } }] }
    const { ctx, getDoc } = makeCtx(doc)
    await handleModifyElement(ctx, makeData({ textContent: '' }))
    const result = getDoc() as { elements: { props: { value: string } }[] }
    expect(result.elements[0].props.value).toBe('')
  })

  test("writes new text when textContent is non-empty", async () => {
    const doc = { elements: [{ id: 'el-1', props: { value: 'Hello', className: 'p-4' } }] }
    const { ctx, getDoc } = makeCtx(doc)
    await handleModifyElement(ctx, makeData({ textContent: 'World' }))
    const result = getDoc() as { elements: { props: { value: string } }[] }
    expect(result.elements[0].props.value).toBe('World')
  })

  test("does not write text when original value is a state binding", async () => {
    const binding = { path: '/state/text' }
    const doc = { elements: [{ id: 'el-1', props: { value: binding, className: 'p-4' } }] }
    const { ctx, getDoc } = makeCtx(doc)
    await handleModifyElement(ctx, makeData({ textContent: 'New Text' }))
    const result = getDoc() as { elements: { props: { value: unknown } }[] }
    // Binding should NOT be overwritten with plain string
    expect(result.elements[0].props.value).toEqual(binding)
  })

  test("does not write text when original value is empty and textContent is empty", async () => {
    const doc = { elements: [{ id: 'el-1', props: { value: '', className: 'p-4' } }] }
    const { ctx, getDoc } = makeCtx(doc)
    await handleModifyElement(ctx, makeData({ textContent: '' }))
    const result = getDoc() as { elements: { props: { value: string } }[] }
    // No change needed — value stays empty
    expect(result.elements[0].props.value).toBe('')
  })

  test("does not write text when original value is absent and textContent is empty", async () => {
    const doc = { elements: [{ id: 'el-1', props: { className: 'p-4' } }] }
    const { ctx, getDoc } = makeCtx(doc)
    await handleModifyElement(ctx, makeData({ textContent: '' }))
    const result = getDoc() as { elements: { props: { value?: string } }[] }
    // Should not add a 'value' key that wasn't there
    expect(result.elements[0].props.value).toBeUndefined()
  })
})
