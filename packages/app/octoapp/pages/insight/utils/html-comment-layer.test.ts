import { expect, test } from "bun:test"
import ts from "typescript"
import type { FileComment } from "../../make/components/result-viewer/comment-popover"

// 执行组件中的真实队列和上传回调，仅替换桌面、HTTP、Toast 边界。
const source = ts.createSourceFile("layer.tsx", await Bun.file(new URL("../components/result-viewer/html-comment-layer.tsx", import.meta.url)).text(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function expression(name: string): string {
  const matches: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) matches.push(node.initializer.getText(source))
    if (ts.isJsxAttribute(node) && node.name.getText(source) === name && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) matches.push(node.initializer.expression.getText(source))
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(matches).toHaveLength(1)
  return matches[0]
}

function uploader(fail?: string) {
  const state = { busy: false, editing: { id: "c1" } }
  const uploads: string[] = []
  const errors: string[] = []
  let stored: FileComment = { id: "c1", filePath: "/a.html", elementId: "el-1", selector: "h1", label: "", text: "", htmlHint: "", note: "修改", position: { x: 0, y: 0, w: 1, h: 1 }, createdAt: 1, updatedAt: 1, attachments: [] }
  const client = {
    load: async () => [structuredClone(stored)],
    upload: async (_id: string, file: File) => {
      if (file.name === fail) throw new Error("上传失败")
      uploads.push(file.name)
      return { id: file.name, filename: file.name }
    },
    save: async (comment: FileComment) => { stored = structuredClone(comment) },
  }
  const code = ts.transpileModule(`
    let generation = 0;
    let disposed = false;
    let operations = Promise.resolve();
    const run = ${expression("run")};
    return { upload: ${expression("onUploadAttachment")}, settled: () => operations, switchFile: () => { generation++; state.busy = false; } };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const api = new Function("review", "state", "setState", "showToast", "getDesktopApi", code)(
    { comments: () => client }, state,
    (key: string, value: unknown) => Object.assign(state, { [key]: value }),
    (toast: { title: string; variant?: string }) => { if (toast.variant === "error") errors.push(toast.title) },
    () => ({ getPathForFile: (file: File) => `/uploads/${file.name}` }),
  ) as { upload: (file: File) => void; settled: () => Promise<void>; switchFile: () => void }
  return { ...api, state, uploads, errors, saved: () => stored }
}

test("一次选择多个附件全部上传，保存时累积而非覆盖，队列结束才解除 busy", async () => {
  const result = uploader()
  result.upload(new File(["a"], "a.txt"))
  result.upload(new File(["b"], "b.txt"))
  expect(result.state.busy).toBe(true)
  await result.settled()
  expect(result.uploads).toEqual(["a.txt", "b.txt"])
  expect(result.saved().attachments?.map(file => file.id)).toEqual(["a.txt", "b.txt"])
  expect(result.state.busy).toBe(false)
})

test("一个附件失败会提示，但后续附件仍上传", async () => {
  const result = uploader("bad.txt")
  result.upload(new File(["a"], "bad.txt"))
  result.upload(new File(["b"], "good.txt"))
  await result.settled()
  expect(result.errors).toEqual(["上传失败"])
  expect(result.saved().attachments?.map(file => file.id)).toEqual(["good.txt"])
  expect(result.state.busy).toBe(false)
})

test("切换文件后取消未开始的上传，不串到新文件", async () => {
  const result = uploader()
  result.upload(new File(["a"], "a.txt"))
  result.upload(new File(["b"], "b.txt"))
  result.switchFile()
  await result.settled()
  expect(result.uploads).toEqual([])
  expect(result.state.busy).toBe(false)
})

test("已有弹窗按实际尺寸避开预览区右侧和底部，附件增高后重新定位", () => {
  const popover = document.createElement("div")
  Object.defineProperties(popover, {
    offsetLeft: { value: 700, configurable: true },
    offsetTop: { value: 500, configurable: true },
    offsetWidth: { value: 320, configurable: true },
    offsetHeight: { value: 240, configurable: true },
  })
  const code = ts.transpileModule(`return (${expression("fit")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const fit = new Function("popover", "width", "height", code)(popover, 800, 600) as () => void
  fit()
  expect(popover.style.transform).toBe("translate(-228px, -148px)")
  Object.defineProperty(popover, "offsetHeight", { value: 400 })
  fit()
  expect(popover.style.transform).toBe("translate(-228px, -308px)")
  Object.defineProperties(popover, { offsetLeft: { value: -20 }, offsetTop: { value: -30 } })
  fit()
  expect(popover.style.transform).toBe("translate(28px, 38px)")
})
