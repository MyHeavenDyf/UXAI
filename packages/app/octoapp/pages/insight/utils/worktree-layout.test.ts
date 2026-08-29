import { describe, expect, test } from "bun:test"
import { isPendingUploadPath, isSessionArtifactPath } from "./worktree-layout"

describe("isPendingUploadPath", () => {
  test("预会话落地区(Windows 反斜杠)", () => {
    expect(isPendingUploadPath("D:\\proj\\.octo\\tmps\\访谈稿.docx")).toBe(true)
  })
  test("预会话落地区(POSIX)", () => {
    expect(isPendingUploadPath("/proj/.octo/tmps/访谈稿.docx")).toBe(true)
  })
  test("已归属会话的不再挪", () => {
    expect(isPendingUploadPath("/proj/.octo/ses_1/uploads/访谈稿.docx")).toBe(false)
  })
  // 落点在 b90d404c6 收进 .octo 根前是 insight/uploads/;老路径不该被当成待搬迁(v7 迁移回归锁)。
  test("旧布局路径不误判", () => {
    expect(isPendingUploadPath("/proj/insight/uploads/访谈稿.docx")).toBe(false)
  })
  test("不在 .octo 下的同名目录不误判", () => {
    expect(isPendingUploadPath("/proj/tmps/访谈稿.docx")).toBe(false)
  })
})

describe("isSessionArtifactPath(SPEC-INS-033 §4.2 路径分桶)", () => {
  test("会话产物区内(git diff 相对路径)", () => {
    expect(isSessionArtifactPath(".octo/ses_1/outputs/报告.md", "ses_1")).toBe(true)
  })
  test("会话产物区内(Windows 绝对路径)", () => {
    expect(isSessionArtifactPath("D:\\proj\\.octo\\ses_1\\outputs\\a.md", "ses_1")).toBe(true)
  })
  // projectDir 可能是仓库子目录:git diff 输出相对仓库根,.octo 前会带子目录前缀,不能 startsWith 判。
  test("projectDir 是仓库子目录时 .octo 不在路径根", () => {
    expect(isSessionArtifactPath("sub/dir/.octo/ses_1/outputs/a.md", "ses_1")).toBe(true)
  })
  test("别的会话的产物区不算", () => {
    expect(isSessionArtifactPath(".octo/ses_2/outputs/a.md", "ses_1")).toBe(false)
  })
  // Make 模块落点 .octo/artifacts/make/<sessionId>/——sessionId 段不在 .octo 直下,不误收。
  test("Make 模块产物区不算", () => {
    expect(isSessionArtifactPath(".octo/artifacts/make/ses_1/x.md", "ses_1")).toBe(false)
  })
  test("不在 .octo 下的路径不算", () => {
    expect(isSessionArtifactPath("src/main.ts", "ses_1")).toBe(false)
  })
  test("路径恰好以 .octo 结尾不算", () => {
    expect(isSessionArtifactPath("foo/.octo", "ses_1")).toBe(false)
  })
})
