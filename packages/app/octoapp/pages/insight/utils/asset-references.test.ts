import { describe, expect, test } from "bun:test"
import { containsProductAssetPath, displayAssetParts, isProductAssetReference, prepareAssetReferences } from "./asset-references"

const root = "/project/.octo/s/uploads/insight-asset-12345678-1234-4234-8234-123456789abc"

describe("Design 同款产品资产地址引用", () => {
  test("文件/文件夹胶囊转换为读取地址指令，显示文本保留原文", () => {
    const assets = [{ filename: "访谈.zip", path: root, isFolder: true }, { filename: "大纲.docx", path: `${root}/大纲.docx` }]
    const result = prepareAssetReferences("@访谈.zip 与 @大纲.docx 帮我分析", assets)
    expect(result.text).toBe(`读取${root} 这个文件夹 与 读取${root}/大纲.docx 这个文件 帮我分析`)
    expect(result.metadata).toEqual({ displayText: "@访谈.zip 与 @大纲.docx 帮我分析", insightProductAssets: assets })
    expect(result.files).toEqual([])
  })

  test("普通引用文件保持原有内联路径，混合选择互不影响", () => {
    const normal = { filename: "会话.txt", path: "/project/.octo/s/uploads/会话.txt" }
    const result = prepareAssetReferences("@访谈.zip @会话.txt", [{ filename: "访谈.zip", path: root, isFolder: true }, normal])
    expect(result.files).toEqual([normal])
    expect(result.assets).toHaveLength(1)
    expect(result.text).toContain("@会话.txt")
  })

  test("旧版展开后的资产文件仍识别为产品资产，不再读取正文", () => {
    const file = { filename: "访谈 (12345678).txt", path: `${root}/访谈.txt` }
    expect(isProductAssetReference(file)).toBe(true)
    expect(prepareAssetReferences(`@${file.filename}`, [file]).files).toEqual([])
  })

  test("路径中的美元符号、空格和反斜杠原样传递", () => {
    const path = "C:\\project $&\\.octo\\s\\uploads\\insight-asset-12345678-1234-4234-8234-123456789abc"
    expect(prepareAssetReferences("@包.zip", [{ filename: "包.zip", path, isFolder: true }]).text).toBe(`读取${path} 这个文件夹`)
  })

  test("没有产品资产时正文及元数据行为不变", () => {
    const file = { filename: "normal.txt", path: "/project/normal.txt" }
    expect(prepareAssetReferences("原文  保留空格", [file])).toEqual({ text: "原文  保留空格", metadata: undefined, assets: [], files: [file] })
  })

  test("资产路径与用户正文中的连续空格和零宽字符原样保留", () => {
    const path = `C:/work  project${root}/a  b\u200b.txt`
    const result = prepareAssetReferences("@asset.txt 请保留  两个空格", [{ filename: "asset.txt", path }])
    expect(result.text).toBe(`读取${path} 这个文件 请保留  两个空格`)
    expect(result.metadata?.insightProductAssets[0].path).toBe(path)
  })

  test("正文再次写出已选资产的路径时，也不会误入自动内联；普通路径不受影响", () => {
    const assets = [{ filename: "包.zip", path: "C:\\project\\selected", isFolder: true }]
    expect(containsProductAssetPath("c:/PROJECT/selected/nested/../a.txt", assets)).toBe(true)
    expect(containsProductAssetPath("C:/project/selected2/a.txt", assets)).toBe(false)
    expect(containsProductAssetPath("/project/normal.txt", [])).toBe(false)
  })

  test("消息展示只替换本地投影，模型文本和普通消息保持原样", () => {
    const model = { type: "text", text: `读取${root} 这个文件夹`, metadata: { displayText: "@访谈.zip", insightProductAssets: [{ filename: "访谈.zip", path: root, isFolder: true }] } }
    const ordinary = { type: "text", text: "普通消息" }
    const shown = displayAssetParts([model, ordinary])
    expect(shown[0].text).toBe("@访谈.zip")
    expect(model.text).toBe(`读取${root} 这个文件夹`)
    expect(shown[1]).toBe(ordinary)
  })
})
