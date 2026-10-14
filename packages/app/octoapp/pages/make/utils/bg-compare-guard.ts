// 后台读盘比对的竞态守卫(handleOpenResult 激活已有 tab 后的异步内容比对)。
//
// 问题:激活后异步 readFileBuffer,期间可能发生——
//   1. 用户编辑 / agent 更新文件 → tab.content 已变;
//   2. 再次激活同 tab 发起第二次读盘,且两次乱序完成(较旧的晚回)。
// 旧实现只检查「tab 是否还在」,较旧的读盘结果仍会 updateTabContent 覆盖较新内容。
//
// 两道守卫:
//   1. 版本号:issue 给出递增 token;apply 时 token 须仍是最新,否则有更新的读盘发起过 → 放弃。
//   2. 内容快照:apply 时 tab 当前内容须仍等于发起时的快照内容,否则期间已被外部改动 → 放弃覆盖。
// 见 docs / review: PR dev_zf「perf(make): 媒体类型预览非阻塞打开」P2 反馈。

/** 守卫句柄。token 是发起读盘时拿到的版本号;apply 时原样回传。 */
export interface BgCompareGuard {
  /** 发起一次读盘前调用,返回递增 token。 */
  issue(tabId: string): number
  /** 读盘完成后调用:token 仍是最新 且 tab 当前内容仍等于快照 → true(可安全更新)。 */
  canApply(tabId: string, token: number, currentContent: string, snapshotContent: string): boolean
}

export function createBgCompareGuard(): BgCompareGuard {
  const gen = new Map<string, number>()
  return {
    issue(tabId) {
      const next = (gen.get(tabId) ?? 0) + 1
      gen.set(tabId, next)
      return next
    },
    canApply(tabId, token, currentContent, snapshotContent) {
      if (gen.get(tabId) !== token) return false
      if (currentContent !== snapshotContent) return false
      return true
    },
  }
}
