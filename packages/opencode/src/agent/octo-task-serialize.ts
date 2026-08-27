import type { Plugin } from "@opencode-ai/plugin"

// insight 子代理串行闸(SPEC-INS-032 §5.4)
//
// 背景:多文档分治要求「一份回来了再派下一份」,但这件事此前**只有提示词在劝**,三层都没有闸:
//   · llm.ts 的工具调用是 `concurrency: "unbounded"` —— 一条 assistant 消息里的多个 task 全部并发跑;
//   · task 工具本体没有任何 in-flight 检查;
//   · 而上游 task.txt 的工具描述原文写着「Launch multiple agents concurrently whenever possible」,
//     和我们的提示词正好相反 —— 弱模型听离它更近的那个。
// 内网实测(2026-08-27):模型一次并发派了 3 个 insight_reader,直接撞上模型网关的分钟级限流,
// 整轮中断;用户点「继续」后子任务结果已丢,父代理拿着几个会话 id 乱查、最后放弃分治退回自读。
//
// 更硬的约束来自容量本身:内网模型**全量用户的并发只有几十个**,一个用户开 3–5 路子代理
// 就吃掉全站可观的比例 —— 这不是「偶发限流」,是多用户公平性问题。
//
// 为什么是**排队**而不是**拒绝**:拒绝会在对话里挂出失败卡片,并把「要不要重派」交回给模型
// (实测它的选择是放弃分治);排队则把并发调用透明地串成串行,没有失败卡片、不依赖模型自觉。
// 父代理本来就在等工具返回,排队不额外占用模型并发。
//
// 只作用于 insight 会话:chat / make / studio 的 task 用法不在本 spec 范围,不改它们的行为。
const LOG = "[octo:task-queue]"
const INSIGHT_AGENT = "octo_insight"

/** 单个子任务最长持锁时间。超过即自动释放,防止某次异常退出把后续全堵死(tool.execute.after 在
 *  工具抛错时不触发,所以**不能**只靠它解锁)。取 10 分钟:实测单份通读在分钟级,留足余量。 */
const MAX_HOLD_MS = 10 * 60 * 1000

/** 排队者最长等待时间。到点即放行 —— 宁可退化成并发,也不要把一轮永久卡住。 */
const MAX_WAIT_MS = 10 * 60 * 1000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const OctoTaskSerializePlugin: Plugin = async ({ client }) => {
  /** sessionID → 当前 in-flight 子任务的完成信号 */
  const inflight = new Map<string, Promise<void>>()
  /** callID → 释放函数(在 tool.execute.after 或超时时调用) */
  const releases = new Map<string, () => void>()
  /** sessionID → 链尾那次调用的 callID(判断"我还是不是最后一个"用) */
  const owners = new Map<string, string>()
  /** sessionID → 是否 insight 会话(agent 对会话不变,可缓存) */
  const isInsight = new Map<string, boolean>()

  const insightSession = async (sessionID: string) => {
    const cached = isInsight.get(sessionID)
    if (cached !== undefined) return cached
    try {
      const res = await client.session.get({ path: { id: sessionID } })
      const agent = (res as { data?: { agent?: string } }).data?.agent
      const hit = agent === INSIGHT_AGENT
      isInsight.set(sessionID, hit)
      return hit
    } catch (err) {
      // 读不到就不拦(交回原生并发行为),不阻断调用
      console.error(`${LOG} session.get 失败,本次不排队`, { sessionID, err })
      return false
    }
  }

  return {
    "tool.execute.before": async (input) => {
      if (input.tool !== "task") return
      if (!(await insightSession(input.sessionID))) return

      const prev = inflight.get(input.sessionID)

      // 先占位再等待:同一条 assistant 消息里的 N 个并发 task 会依次串到这条链上。
      let release!: () => void
      const mine = new Promise<void>((resolve) => {
        release = resolve
      })
      const timer = setTimeout(() => {
        console.error(`${LOG} 子任务持锁超时,强制释放`, { sessionID: input.sessionID, callID: input.callID })
        release()
      }, MAX_HOLD_MS)
      releases.set(input.callID, () => {
        clearTimeout(timer)
        release()
      })
      inflight.set(input.sessionID, mine)
      owners.set(input.sessionID, input.callID)

      if (prev) {
        console.log(`${LOG} 已有子任务在跑,本次排队`, { sessionID: input.sessionID, callID: input.callID })
        await Promise.race([prev, sleep(MAX_WAIT_MS)])
      }
    },

    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return
      const release = releases.get(input.callID)
      if (!release) return
      releases.delete(input.callID)
      release()
      // 链尾清理:只有链尾还是本次时才删(后来者已经把自己登记上去了就别动),
      // 避免 Map 随会话数无限增长。留着一个已 resolve 的 promise 也无害——下一位 await 它即刻返回。
      if (owners.get(input.sessionID) === input.callID) {
        inflight.delete(input.sessionID)
        owners.delete(input.sessionID)
      }
    },
  }
}
