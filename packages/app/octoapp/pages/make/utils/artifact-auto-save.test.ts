/**
 * 代码类型工作区 (project mode) 路径推导测试:
 * - computeArtifactFilePath: kind="code" 产物落项目根,普通工作区落 .octo/<sid>/outputs
 * - extractCommentFilePath: 代码工作区按项目根推导标注定位键,普通工作区走 .octo/<sid>/ 前缀
 * - getProjectRelativePath: 项目根内文件的相对路径
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/artifact-auto-save.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"
import { computeArtifactFilePath } from "./artifact-auto-save"
import { extractCommentFilePath, getProjectRelativePath, getArtifactRelativePath } from "./artifact-file-api"

describe("computeArtifactFilePath", () => {
  test("normal 工作区落 .octo/<sessionId>/outputs", () => {
    expect(computeArtifactFilePath("落地页", "html", "ses_1", "/proj")).toBe("/proj/.octo/ses_1/outputs/落地页.html")
  })

  test("normal 工作区 Windows 分隔符", () => {
    expect(computeArtifactFilePath("page", "svg", "ses_1", "D:\\proj")).toBe("D:\\proj\\.octo\\ses_1\\outputs\\page.svg")
  })

  test("code 工作区落项目根(所有 session 共享)", () => {
    expect(computeArtifactFilePath("落地页", "html", "ses_1", "/proj", "code")).toBe("/proj/落地页.html")
    expect(computeArtifactFilePath("page", "svg", "ses_2", "D:\\proj", "code")).toBe("D:\\proj\\page.svg")
  })

  test("code 工作区标题已带扩展名不重复追加", () => {
    expect(computeArtifactFilePath("index.html", "html", "ses_1", "/proj", "code")).toBe("/proj/index.html")
  })
})

describe("getProjectRelativePath", () => {
  test("项目根内文件返回相对路径", () => {
    expect(getProjectRelativePath("/proj/src/page.html", "/proj")).toBe("src/page.html")
    expect(getProjectRelativePath("D:\\proj\\index.html", "D:\\proj")).toBe("index.html")
  })

  test("项目根外返回 null", () => {
    expect(getProjectRelativePath("/other/page.html", "/proj")).toBeNull()
    expect(getProjectRelativePath("/proj", "/proj")).toBeNull()
  })
})

describe("extractCommentFilePath", () => {
  test("普通工作区:命中 .octo/<sid>/ 前缀返回相对 sessionDir 路径", () => {
    expect(extractCommentFilePath("/proj/.octo/ses_1/outputs/page.html", "ses_1")).toBe("outputs/page.html")
    expect(extractCommentFilePath("/proj/.octo/ses_1/outputs/sub/a.html", "ses_1")).toBe("outputs/sub/a.html")
  })

  test("普通工作区:不命中时兜底返回文件名", () => {
    expect(extractCommentFilePath("/proj/page.html", "ses_1")).toBe("page.html")
  })

  test("代码工作区:按项目根推导(嵌套路径保留目录结构,避免同名文件标注串扰)", () => {
    expect(extractCommentFilePath("/proj/index.html", "", "/proj")).toBe("index.html")
    expect(extractCommentFilePath("/proj/src/pages/a.html", "", "/proj")).toBe("src/pages/a.html")
    expect(extractCommentFilePath("D:\\proj\\src\\a.html", "", "D:\\proj")).toBe("src/a.html")
  })

  test("代码工作区:session 文件仍优先走 .octo/<sid>/ 前缀分支", () => {
    expect(extractCommentFilePath("/proj/.octo/ses_1/outputs/page.html", "ses_1", "/proj")).toBe("outputs/page.html")
  })

  test("代码工作区:项目根外兜底返回文件名", () => {
    expect(extractCommentFilePath("/other/page.html", "", "/proj")).toBe("page.html")
  })
})

describe("getArtifactRelativePath (session 前缀解析,保持原行为)", () => {
  test("解析 .octo/<sid>/ 路径", () => {
    expect(getArtifactRelativePath("/proj/.octo/ses_1/outputs/a.html")).toEqual({
      sessionId: "ses_1",
      relativePath: "outputs/a.html",
    })
  })

  test("非 .octo 路径返回 null", () => {
    expect(getArtifactRelativePath("/proj/a.html")).toBeNull()
  })
})
