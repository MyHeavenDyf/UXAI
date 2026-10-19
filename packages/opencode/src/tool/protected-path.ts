import path from "path"
import { realpathSync } from "node:fs"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

// Skill 库目录由应用技能库统一管理(桌面端部署/增删走 app 侧原生 fs),
// agent 只能读取,不允许通过任何文件工具(edit/write/apply_patch)修改。
// 需要扩大保护范围时在此列表追加目录即可。
const protectedDirs = [path.join(Global.Path.octoConfig, "skill")]

const realpathNative = typeof realpathSync.native === "function" ? realpathSync.native : realpathSync

// 解析最长「已存在」祖先的真实路径并保留不存在尾段(新建文件场景),
// 消掉 `..`、混合分隔符、大小写(win32)、符号链接、8.3 短名等路径变体。
// realpath 因非 ENOENT 错误失败(如杀软瞬时占用)时退回规范化路径,守卫只松不炸。
function realPath(input: string): string {
  const base = path.resolve(AppFileSystem.windowsPath(input))
  const tail: string[] = []
  let cur = base
  while (true) {
    try {
      return path.join(realpathNative(cur), ...tail)
    } catch (e) {
      if ((e as { code?: string })?.code !== "ENOENT") return base
      const parent = path.dirname(cur)
      if (parent === cur) return base
      tail.unshift(path.basename(cur))
      cur = parent
    }
  }
}

export function findProtectedDir(target: string, dirs: readonly string[] = protectedDirs): string | undefined {
  const full = realPath(target)
  for (const dir of dirs) {
    // 双形式匹配:dir 原串覆盖目录尚未真实存在的场景,realPath(dir) 覆盖
    // 其祖先(如 ~/.config)是符号链接、target 已被解析到真实路径的场景
    if (AppFileSystem.contains(dir, full) || AppFileSystem.contains(realPath(dir), full)) return dir
  }
  return undefined
}

export const assertNotProtectedPath = Effect.fn("Tool.assertNotProtectedPath")(function* (target?: string) {
  if (!target) return
  const hit = findProtectedDir(target)
  if (!hit) return
  return yield* Effect.fail(
    new Error(
      `Cannot modify "${target}": "${hit}" is the app-managed skill library and is read-only for the agent. ` +
        `Do not edit, write, create, move, or delete files under it; if the user wants to change skills, ask them to use the skill library in the app instead.`,
    ),
  ).pipe(Effect.orDie)
})
