import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 回归防线:design(make)侧栏最近列表分页必须请求 order=sort_order。
// 服务端默认按 time desc 分页,而 AgentSidebar.recentSessions 按 sort_order
// asc + time desc 显示;顺序不一致时,后续页含 sort_order 更小的会话会被客户端
// 重排到已显示条目之上,把列表第一条顶下去(详见 opencode 侧
// global-session-list.test.ts 的排序用例)。参数一旦丢失,行为会静默退回
// time desc——typecheck 不报错,只能靠源码扫描锁住。
// 同属源码扫描式回归防线(octoapp 测试按需运行,不被 packages/app 的
// test:unit——其只跑 ./src——收集)。
const SRC = readFileSync(join(import.meta.dir, "sidebar.tsx"), "utf8")

describe("make 侧栏最近列表分页按显示顺序请求", () => {
  test("fetchSessionPage 传 order: \"sort_order\"", () => {
    expect(SRC).toMatch(/order:\s*"sort_order"/)
  })

  test("分页请求限定 agent + directory(防止 order 参数加错到 pinned/grouped 拉取上)", () => {
    const fetcher = SRC.slice(SRC.indexOf("fetchSessionPage"), SRC.indexOf("fetchPinnedSessions"))
    expect(fetcher).toMatch(/directory:\s*dir/)
    expect(fetcher).toMatch(/agent:\s*"octo_make"/)
  })
})
