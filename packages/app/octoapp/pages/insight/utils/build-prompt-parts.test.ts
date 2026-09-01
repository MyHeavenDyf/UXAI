import { describe, expect, test } from "bun:test"
import {
  assembleInsightParts,
  decideInlineStrategy,
  DOC_COUNT_THRESHOLD,
  DOC_SINGLE_BYTES,
  INLINE_BUDGET,
  SINGLE_DOC_LIMIT,
} from "./build-prompt-parts"

/**
 * SPEC-INS-027：正常发送与排队 drain 共用的 parts 组装骨架单测。
 * 锁死顺序契约（cleanText → synthetic → txt/md FilePart → 图片 FilePart）与 FilePart 映射，
 * 防止两条发送路径漂移。
 */
describe("assembleInsightParts", () => {
  test("纯文本：只有一个 text part", () => {
    const { parts, imageParts } = assembleInsightParts({ text: "hi" })
    expect(parts).toEqual([{ type: "text", text: "hi" }])
    expect(imageParts).toEqual([])
  })

  test("synthetic 文本按序追加、均标 synthetic", () => {
    const { parts } = assembleInsightParts({ text: "hi", syntheticTexts: ["[附件]…", "chipT", "chipD"] })
    expect(parts).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "[附件]…", synthetic: true },
      { type: "text", text: "chipT", synthetic: true },
      { type: "text", text: "chipD", synthetic: true },
    ])
  })

  test("空串的 synthetic 被跳过", () => {
    const { parts } = assembleInsightParts({ text: "hi", syntheticTexts: ["", "x", ""] })
    expect(parts).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "x", synthetic: true },
    ])
  })

  test("文本类 → file part(file://, text/plain)；office 被过滤掉", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.md", path: "/p/a.md" },
        { filename: "b.docx", path: "/p/b.docx" }, // office → extract_document，不内联
      ],
    })
    const fileParts = parts.filter((p) => p.type === "file")
    expect(fileParts).toEqual([{ type: "file", mime: "text/plain", url: "file:///p/a.md", filename: "a.md" }])
  })

  // 2026-08-20：内联判定改为**反向排除**（只排 office/pdf/图片，其余交服务端 read 判二进制），
  // 这样上传格式放开（json/csv…）时无需再同步一次内联清单。
  test("反向排除：非 office/pdf/图片的文本类一律内联（csv/json/log/html/无扩展名）", () => {
    const files = [
      { filename: "a.csv", path: "/p/a.csv" },
      { filename: "b.json", path: "/p/b.json" },
      { filename: "c.log", path: "/p/c.log" },
      { filename: "d.html", path: "/p/d.html" },
      { filename: "README", path: "/p/README" },
      { filename: "e.mmd", path: "/p/e.mmd" },
    ]
    const { parts } = assembleInsightParts({ text: "hi", textInlineFiles: files })
    expect(parts.filter((p) => p.type === "file").map((p) => p.filename)).toEqual(files.map((f) => f.filename))
  })

  test("反向排除：office / pdf / 图片都不走内联", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.docx", path: "/p/a.docx" },
        { filename: "b.xlsx", path: "/p/b.xlsx" },
        { filename: "c.pptx", path: "/p/c.pptx" },
        { filename: "d.pdf", path: "/p/d.pdf" },
        { filename: "e.png", path: "/p/e.png" },
        { filename: "f.jpeg", path: "/p/f.jpeg" },
      ],
    })
    expect(parts.filter((p) => p.type === "file")).toEqual([])
  })

  // `@` 引用的文件与附件由调用方合并后传入同一入参（SPEC-INS-023 §7.2 2026-08-20 修订）：
  // 同一文件既是本轮附件、又被 `@` 引用时只内联一次，否则同份正文在上下文里存两遍。
  test("同一 path 出现两次（附件 + @ 引用）只内联一次", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [
        { filename: "a.md", path: "/p/a.md" },
        { filename: "a.md", path: "/p/a.md" },
        { filename: "b.md", path: "/p/b.md" },
      ],
    })
    expect(parts.filter((p) => p.type === "file").map((p) => p.filename)).toEqual(["a.md", "b.md"])
  })

  test("图片 → vision file part{url:file://…}，mime 缺省 image/png；imageParts 单独返回", () => {
    const { parts, imageParts } = assembleInsightParts({
      text: "hi",
      imageFiles: [
        { filename: "c.png", path: "/p/c.png", mime: "image/png" },
        { filename: "d.jpg", path: "/p/d.jpg" },
      ],
    })
    expect(imageParts).toEqual([
      { type: "file", mime: "image/png", url: "file:///p/c.png", filename: "c.png" },
      { type: "file", mime: "image/png", url: "file:///p/d.jpg", filename: "d.jpg" },
    ])
    // parts 尾部即 imageParts
    expect(parts.slice(-2)).toEqual(imageParts)
  })

  // 2026-09 去 S3:图片本地路径的编码与 txt/md 内联同款 encodeFilePath,
  // Windows 反斜杠/盘符/中文与空格是主战场,锁死编码契约。
  test("图片路径编码：Windows 反斜杠/盘符 → file:///C:/…，中文与空格被编码", () => {
    const { imageParts } = assembleInsightParts({
      text: "hi",
      imageFiles: [{ filename: "图 1.png", path: "C:\\Users\\y\\.octo\\ses_x\\uploads\\图 1.png" }],
    })
    expect(imageParts[0]?.url).toBe(
      "file:///C:/Users/y/.octo/ses_x/uploads/%E5%9B%BE%201.png",
    )
  })

  test("完整顺序：text → synthetic → txt/md → 图片", () => {
    const { parts } = assembleInsightParts({
      text: "T",
      syntheticTexts: ["S1", "S2"],
      textInlineFiles: [{ filename: "a.md", path: "/a.md" }],
      imageFiles: [{ filename: "c.png", path: "/p/c.png" }],
    })
    expect(parts.map((p) => (p.type === "text" ? p.text : `file:${p.filename}`))).toEqual([
      "T",
      "S1",
      "S2",
      "file:a.md",
      "file:c.png",
    ])
  })
})

/**
 * SPEC-INS-032 §2.3 / §2.4：内联分层判定。
 *
 * 用例断言的是**相对预算**的行为（用 INLINE_BUDGET / SINGLE_DOC_LIMIT 算出入参），不写死字节数——
 * 换模型刷新阈值（spec §2.5.4）时这些用例不需要跟着改。
 */
describe("decideInlineStrategy", () => {
  const f = (filename: string, bytes: number, path = `/p/${filename}`) => ({ filename, path, bytes })
  const doc = (filename: string, bytes = 1024, path = `/p/${filename}`) => ({ filename, path, bytes })

  // ── SPEC-INS-032 §2.6：office / pdf 的份数口径 ────────────────────────────
  // 这类文件发送前只有二进制大小、拿不到正文体量，故不并入字节预算，按份数判。
  // 用例写成相对 DOC_COUNT_THRESHOLD / DOC_SINGLE_BYTES，调阈值不用改用例。

  test("office 少于阈值份数且不大 → inline（父代理自己读更快）", () => {
    const files = Array.from({ length: DOC_COUNT_THRESHOLD - 1 }, (_, i) => doc(`访谈${i}.docx`))
    const d = decideInlineStrategy(files)
    expect(d.mode).toBe("inline")
    expect(d.docs).toHaveLength(DOC_COUNT_THRESHOLD - 1)
    expect(d.reasons).toEqual([])
  })

  test("office 达到阈值份数 → dispatch（doc-count）", () => {
    const files = Array.from({ length: DOC_COUNT_THRESHOLD }, (_, i) => doc(`访谈${i}.docx`))
    const d = decideInlineStrategy(files)
    expect(d.mode).toBe("dispatch")
    expect(d.reasons).toContain("doc-count")
  })

  test("单份 office 超二进制兜底 → dispatch（doc-size），哪怕只有一份", () => {
    const d = decideInlineStrategy([doc("超大.docx", DOC_SINGLE_BYTES + 1)])
    expect(d.mode).toBe("dispatch")
    expect(d.reasons).toEqual(["doc-size"])
    expect(d.largeDocs.map((x) => x.filename)).toEqual(["超大.docx"])
  })

  test("office 的字节**不**计入文本预算（两套口径互不污染）", () => {
    // 一份巨大的 docx + 一个很小的 md：文本预算只看那个 md
    const d = decideInlineStrategy([doc("大.docx", DOC_SINGLE_BYTES + 1), f("小.md", 100)])
    expect(d.totalBytes).toBe(100)
    expect(d.files.map((x) => x.filename)).toEqual(["小.md"])
    expect(d.reasons).toEqual(["doc-size"])
  })

  test("混合命中两条判据 → reasons 都记上，仍是整批 dispatch", () => {
    const files = [
      f("长文.md", INLINE_BUDGET + 1),
      ...Array.from({ length: DOC_COUNT_THRESHOLD }, (_, i) => doc(`访谈${i}.docx`)),
    ]
    const d = decideInlineStrategy(files)
    expect(d.mode).toBe("dispatch")
    expect(d.reasons).toContain("text-budget")
    expect(d.reasons).toContain("doc-count")
  })

  test("图片两个口径都不参与", () => {
    const d = decideInlineStrategy([
      { filename: "截图.png", path: "/p/截图.png", bytes: DOC_SINGLE_BYTES + 1 },
      f("小.md", 100),
    ])
    expect(d.mode).toBe("inline")
    expect(d.docs).toEqual([])
    expect(d.files.map((x) => x.filename)).toEqual(["小.md"])
  })


  test("总字节在预算内 → inline，行为与 v2 之前一致", () => {
    const d = decideInlineStrategy([f("a.md", 1000), f("b.txt", 2000)])
    expect(d.mode).toBe("inline")
    expect(d.totalBytes).toBe(3000)
    expect(d.oversized).toEqual([])
  })

  test("恰好等于预算 → 仍走 inline（边界取闭区间）", () => {
    const d = decideInlineStrategy([f("a.md", INLINE_BUDGET)])
    expect(d.mode).toBe("inline")
  })

  test("超预算 1 字节 → dispatch", () => {
    const d = decideInlineStrategy([f("a.md", INLINE_BUDGET + 1)])
    expect(d.mode).toBe("dispatch")
  })

  test("多份累加超预算 → dispatch（单份都不超也一样）", () => {
    const each = Math.ceil(INLINE_BUDGET / 4)
    const d = decideInlineStrategy([f("a.md", each), f("b.md", each), f("c.md", each), f("d.md", each), f("e.md", each)])
    expect(d.mode).toBe("dispatch")
    expect(d.files).toHaveLength(5)
    expect(d.oversized).toEqual([])
  })

  test("office / 图片不占内联预算", () => {
    const d = decideInlineStrategy([f("big.docx", INLINE_BUDGET * 10), f("a.md", 100)])
    expect(d.mode).toBe("inline")
    expect(d.totalBytes).toBe(100)
    expect(d.files.map((x) => x.filename)).toEqual(["a.md"])
  })

  test("同一 path 既是附件又被 @ 引用 → 只算一次", () => {
    const d = decideInlineStrategy([f("a.md", 1000), f("a.md", 1000)])
    expect(d.files).toHaveLength(1)
    expect(d.totalBytes).toBe(1000)
  })

  test("单份超 SINGLE_DOC_LIMIT → 进 oversized，且整批必然 dispatch", () => {
    const d = decideInlineStrategy([f("huge.md", SINGLE_DOC_LIMIT + 1), f("a.md", 10)])
    expect(d.mode).toBe("dispatch")
    expect(d.oversized.map((x) => x.filename)).toEqual(["huge.md"])
  })

  test("bytes 缺失 → 按 0 计入并记 unknownCount（不因取不到大小把整批拖进分治）", () => {
    const d = decideInlineStrategy([{ filename: "a.md", path: "/p/a.md" }, f("b.md", 100)])
    expect(d.mode).toBe("inline")
    expect(d.totalBytes).toBe(100)
    expect(d.unknownCount).toBe(1)
  })
})

describe("assembleInsightParts × 内联分层（SPEC-INS-032）", () => {
  const big = (filename: string) => ({ filename, path: `/p/${filename}`, bytes: INLINE_BUDGET })

  test("dispatch 时一个 text/plain FilePart 都不产（只剩 text/synthetic）", () => {
    const { parts } = assembleInsightParts({
      text: "汇总一下",
      syntheticTexts: ["[附件]\n- a.md: /p/a.md", "[材料体量] …"],
      textInlineFiles: [big("a.md"), big("b.md")],
    })
    expect(parts.filter((p) => p.type === "file")).toEqual([])
    expect(parts).toHaveLength(3)
  })

  test("dispatch 不影响图片：vision FilePart 照常产出", () => {
    const { parts, imageParts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [big("a.md"), big("b.md")],
      imageFiles: [{ filename: "s.png", path: "/p/s.png" }],
    })
    expect(imageParts).toHaveLength(1)
    expect(parts.filter((p) => p.type === "file")).toHaveLength(1)
  })

  test("inline 时仍产出 text/plain FilePart（回归锁）", () => {
    const { parts, inlineDecision } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [{ filename: "a.md", path: "/p/a.md", bytes: 10 }],
    })
    expect(inlineDecision.mode).toBe("inline")
    expect(parts.filter((p) => p.type === "file")).toHaveLength(1)
  })

  test("传入的 inlineDecision 优先于内部现算（防说明与实际产出漂移）", () => {
    const { parts } = assembleInsightParts({
      text: "hi",
      textInlineFiles: [{ filename: "a.md", path: "/p/a.md", bytes: 10 }],
      inlineDecision: decideInlineStrategy([big("a.md"), big("b.md")]),
    })
    expect(parts.filter((p) => p.type === "file")).toEqual([])
  })
})
