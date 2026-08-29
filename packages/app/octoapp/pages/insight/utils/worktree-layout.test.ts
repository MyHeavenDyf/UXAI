import { describe, expect, test } from "bun:test"
import { isPendingUploadPath } from "./worktree-layout"

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
