import { describe, expect, test } from "bun:test"
import { importFileToWorktree } from "./worktree-import"

/**
 * 粘贴链路回归网(评审 P2-2):copySourceToWorktree 抽成注入依赖的纯函数后,
 * 四条分支各锁一例——其中「内存 blob → writeFileToWorktree 字节写入」正是
 * 微信截图粘贴断链(报「无法获取本地路径」)那条路径。
 */
describe("importFileToWorktree", () => {
  const blob = (name = "image.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })

  test("磁盘来源(有源路径)→ 走 copyFileToWorktree 流式拷贝", async () => {
    const dest = await importFileToWorktree(
      { filename: "图.png", file: blob() },
      {
        baseDir: "C:/proj",
        api: {
          getPathForFile: () => "C:/Users/y/Pictures/图.png",
          copyFileToWorktree: async (src, base, name) => `copied:${src}|${base}|${name}`,
          writeFileToWorktree: async () => {
            throw new Error("不应走字节写入")
          },
        },
      },
    )
    expect(dest).toBe("copied:C:/Users/y/Pictures/图.png|C:/proj|图.png")
  })

  test("内存 blob(截图粘贴,无源路径)→ 走 writeFileToWorktree 字节写入,原样字节透传", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    let received: { buffer: ArrayBuffer; baseDir: string; filename: string } | undefined
    const dest = await importFileToWorktree(
      { filename: "image.png", file: new File([bytes], "image.png", { type: "image/png" }) },
      {
        baseDir: "C:/proj",
        api: {
          getPathForFile: () => "",
          copyFileToWorktree: async () => {
            throw new Error("不应走拷贝")
          },
          writeFileToWorktree: async (buffer, base, name) => {
            received = { buffer, baseDir: base, filename: name }
            return "C:/proj/.octo/tmps/image.png"
          },
        },
      },
    )
    expect(dest).toBe("C:/proj/.octo/tmps/image.png")
    expect(received?.baseDir).toBe("C:/proj")
    expect(received?.filename).toBe("image.png")
    expect(Array.from(new Uint8Array(received!.buffer))).toEqual(Array.from(bytes))
  })

  test("getPathForFile 抛错(同样视为内存 blob)→ 走字节写入兜底", async () => {
    const dest = await importFileToWorktree(
      { filename: "a.jpg", file: blob("a.jpg") },
      {
        baseDir: "C:/proj",
        api: {
          getPathForFile: () => {
            throw new Error("no path for blob")
          },
          writeFileToWorktree: async (_b, _d, name) => `written:${name}`,
        },
      },
    )
    expect(dest).toBe("written:a.jpg")
  })

  test("降级:无 baseDir / 无对应 IPC → 返回 null,不抛错", async () => {
    expect(await importFileToWorktree({ filename: "a.png", file: blob() }, { baseDir: undefined })).toBeNull()
    expect(await importFileToWorktree({ filename: "a.png", file: blob() }, { baseDir: "C:/proj", api: {} })).toBeNull()
    // 磁盘来源但 preload 未暴露拷贝 IPC(旧 preload)
    expect(
      await importFileToWorktree(
        { filename: "a.png", file: blob() },
        { baseDir: "C:/proj", api: { getPathForFile: () => "C:/src.png" } },
      ),
    ).toBeNull()
    // 内存 blob 但 preload 未暴露写入 IPC(旧 preload,即粘贴截图断链场景的旧环境形态)
    expect(
      await importFileToWorktree(
        { filename: "a.png", file: blob() },
        { baseDir: "C:/proj", api: { getPathForFile: () => "" } },
      ),
    ).toBeNull()
  })

  test("真失败(IPC 抛错)→ 上抛给调用方转可重试错误", async () => {
    await expect(
      importFileToWorktree(
        { filename: "a.png", file: blob() },
        {
          baseDir: "C:/proj",
          api: {
            getPathForFile: () => "",
            writeFileToWorktree: async () => {
              throw new Error("disk full")
            },
          },
        },
      ),
    ).rejects.toThrow("disk full")
  })
})
