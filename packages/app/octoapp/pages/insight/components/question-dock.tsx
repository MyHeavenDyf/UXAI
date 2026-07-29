import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import "./question-dock.css"

// InsightQuestionDock —— insight 聊天面板的 question 工具答题 UI(SPEC-INS-025)。
//
// 背景:`question` 工具此前在 insight **根本不可见** —— agent.ts 的全局 defaults 里
// `question: "deny"`(只有 plan agent 显式 allow),octo_insight 继承了这条默认 deny,
// Permission.disabled 把它从模型工具列表整个摘掉,模型会直接回「我没有名为 question 的工具」。
// 故本次同时在 agent.ts 的 octo_insight 权限里显式 `question: "allow"`,工具才进得来。
//
// 放开之后才轮到 UI 问题:服务端 Question.ask 在 Deferred 上阻塞等答复,insight 若没有答题 UI,
// 模型一调用就界面无入口、会话永久挂起。与 SPEC-INS-021 §2 的权限询问同源同病,故按同款自包含方式补齐。
//
// 数据流:question.asked 由全局 event-reducer 写入 sync.data.question(按 sessionID 分桶);
// 这里取当前会话(含 task 子代理的子会话——insight 保留 task,子会话的询问也要浮上来)的第一条
// 待答请求渲染;回答走 sdk.client.question.reply / .reject。
//
// 与 pages/session/composer/session-question-dock.tsx 的关系:交互按它 port,但**不跨页面 import**
// (insight 页面自包含原则,同 permission-dock)。两点有意偏离:
//   ① 丢掉上游的 measure() —— 它按 session 页 DOM(.scroll-view__viewport / session-prompt-dock)
//      反推 --question-prompt-max-height,insight 输入区结构不同,改为在 question-dock.css 里给
//      定值,不做脆弱的 DOM 耦合。
//   ② 尊重 schema 的 custom 字段(custom === false 时不渲染「输入自己的答案」行),上游 dock 恒显示。

/** 单题结构(= 服务端 Question.Info)。 */
type QuestionItem = QuestionRequest["questions"][number]

/** 半填答案缓存:dock 因路由切换卸载后回来不丢已选项。按 request.id 存,回答成功即清。 */
const cache = new Map<string, { tab: number; answers: QuestionAnswer[]; custom: string[]; customOn: boolean[] }>()

function Mark(props: { multi: boolean; picked: boolean; onClick?: (event: MouseEvent) => void }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true" onClick={props.onClick}>
      <span data-slot="question-option-box" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
        <Show when={props.multi} fallback={<span data-slot="question-option-radio-dot" />}>
          <Icon name="check-small" size="small" />
        </Show>
      </span>
    </span>
  )
}

function Option(props: {
  multi: boolean
  picked: boolean
  label: string
  description?: string
  disabled: boolean
  ref?: (el: HTMLButtonElement) => void
  onFocus?: VoidFunction
  onClick: VoidFunction
}) {
  return (
    <button
      type="button"
      ref={props.ref}
      data-slot="question-option"
      data-picked={props.picked}
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.picked}
      disabled={props.disabled}
      onFocus={props.onFocus}
      onClick={props.onClick}
    >
      <Mark multi={props.multi} picked={props.picked} />
      <span data-slot="question-option-main">
        <span data-slot="option-label">{props.label}</span>
        <Show when={props.description}>
          <span data-slot="option-description">{props.description}</span>
        </Show>
      </span>
    </button>
  )
}

/** 纯展示层(无 SDK / Sync 依赖):供真实 InsightQuestionDock 与 __dev/question-dock-preview 共用,
 *  预览所见即所得、刷 UI 时样式不会与线上漂移。文案与 i18n 解析留在数据层。 */
export function QuestionDockView(props: {
  questions: QuestionItem[]
  /** 半填缓存键(通常是 request.id);不传则不缓存(dev 预览) */
  cacheKey?: string
  busy?: boolean
  labels: {
    dismiss: string
    back: string
    next: string
    submit: string
    typeOwnAnswer: string
    customPlaceholder: string
    singleHint: string
    multiHint: string
    questions: string
    /** 进度文案,如 (1, 2) => "1/2 个问题" */
    progress: (current: number, total: number) => string
  }
  onReply: (answers: QuestionAnswer[]) => void
  onReject: () => void
}) {
  const questions = createMemo(() => props.questions)
  const total = createMemo(() => questions().length)

  const cached = props.cacheKey ? cache.get(props.cacheKey) : undefined
  const [store, setStore] = createStore({
    tab: cached?.tab ?? 0,
    answers: cached?.answers ?? ([] as QuestionAnswer[]),
    custom: cached?.custom ?? ([] as string[]),
    customOn: cached?.customOn ?? ([] as boolean[]),
    editing: false,
    focus: 0,
  })

  let customRef: HTMLButtonElement | undefined
  let optsRef: HTMLButtonElement[] = []
  let replied = false
  let focusFrame: number | undefined

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const on = createMemo(() => store.customOn[store.tab] === true)
  const multi = createMemo(() => question()?.multiple === true)
  /** schema 的 custom 默认 true,仅显式 false 关闭「输入自己的答案」 */
  const allowCustom = createMemo(() => question()?.custom !== false)
  /** 可聚焦行数 = 选项数(+ 自定义行) */
  const count = createMemo(() => options().length + (allowCustom() ? 1 : 0))
  const last = createMemo(() => store.tab >= total() - 1)
  const sending = createMemo(() => props.busy === true)

  const summary = createMemo(() => props.labels.progress(Math.min(store.tab + 1, total()), total()))

  const customUpdate = (value: string, selected: boolean = on()) => {
    const prev = input().trim()
    const next = value.trim()

    setStore("custom", store.tab, value)
    if (!selected) return

    if (multi()) {
      setStore("answers", store.tab, (current = []) => {
        const removed = prev ? current.filter((item) => item.trim() !== prev) : current
        if (!next) return removed
        if (removed.some((item) => item.trim() === next)) return removed
        return [...removed, next]
      })
      return
    }

    setStore("answers", store.tab, next ? [next] : [])
  }

  const clamp = (i: number) => Math.max(0, Math.min(count() - 1, i))

  const pickFocus = (tab: number = store.tab) => {
    const list = questions()[tab]?.options ?? []
    if (store.customOn[tab] === true) return list.length
    return Math.max(
      0,
      list.findIndex((item) => store.answers[tab]?.includes(item.label) ?? false),
    )
  }

  const focus = (i: number) => {
    const next = clamp(i)
    setStore("focus", next)
    if (store.editing) return
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      const el = next === options().length ? customRef : optsRef[next]
      el?.focus()
    })
  }

  onMount(() => {
    focus(pickFocus())
  })

  onCleanup(() => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    if (replied || !props.cacheKey) return
    cache.set(props.cacheKey, {
      tab: store.tab,
      answers: store.answers.map((a) => (a ? [...a] : [])),
      custom: store.custom.map((s) => s ?? ""),
      customOn: store.customOn.map((b) => b ?? false),
    })
  })

  const submit = () => {
    replied = true
    if (props.cacheKey) cache.delete(props.cacheKey)
    props.onReply(questions().map((_, i) => store.answers[i] ?? []))
  }

  const reject = () => {
    replied = true
    if (props.cacheKey) cache.delete(props.cacheKey)
    props.onReject()
  }

  const answered = (i: number) => {
    if ((store.answers[i]?.length ?? 0) > 0) return true
    return store.customOn[i] === true && (store.custom[i] ?? "").trim().length > 0
  }

  const picked = (answer: string) => store.answers[store.tab]?.includes(answer) ?? false

  const pick = (answer: string, custom: boolean = false) => {
    setStore("answers", store.tab, [answer])
    if (custom) setStore("custom", store.tab, answer)
    if (!custom) setStore("customOn", store.tab, false)
    setStore("editing", false)
  }

  const toggle = (answer: string) => {
    setStore("answers", store.tab, (current = []) => {
      if (current.includes(answer)) return current.filter((item) => item !== answer)
      return [...current, answer]
    })
  }

  const customToggle = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (!multi()) {
      setStore("customOn", store.tab, true)
      setStore("editing", true)
      customUpdate(input(), true)
      return
    }

    const next = !on()
    setStore("customOn", store.tab, next)
    if (next) {
      setStore("editing", true)
      customUpdate(input(), true)
      return
    }

    const value = input().trim()
    if (value) setStore("answers", store.tab, (current = []) => current.filter((item) => item.trim() !== value))
    setStore("editing", false)
    focus(options().length)
  }

  const customOpen = () => {
    if (sending()) return
    setStore("focus", options().length)
    if (!on()) setStore("customOn", store.tab, true)
    setStore("editing", true)
    customUpdate(input(), true)
  }

  const commitCustom = () => {
    setStore("editing", false)
    customUpdate(input())
    focus(options().length)
  }

  const next = () => {
    if (sending()) return
    if (store.editing) commitCustom()

    if (store.tab >= total() - 1) {
      submit()
      return
    }

    const tab = store.tab + 1
    setStore("tab", tab)
    setStore("editing", false)
    focus(pickFocus(tab))
  }

  const back = () => {
    if (sending()) return
    if (store.tab <= 0) return
    const tab = store.tab - 1
    setStore("tab", tab)
    setStore("editing", false)
    focus(pickFocus(tab))
  }

  const jump = (tab: number) => {
    if (sending()) return
    setStore("tab", tab)
    setStore("editing", false)
    focus(pickFocus(tab))
  }

  const move = (step: number) => {
    if (store.editing || sending()) return
    focus(store.focus + step)
  }

  const nav = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return

    if (event.key === "Escape") {
      event.preventDefault()
      reject()
      return
    }

    const mod = (event.metaKey || event.ctrlKey) && !event.altKey
    if (mod && event.key === "Enter") {
      if (event.repeat) return
      event.preventDefault()
      next()
      return
    }

    const target =
      event.target instanceof HTMLElement ? event.target.closest('[data-slot="question-options"]') : undefined
    if (store.editing) return
    if (!(target instanceof HTMLElement)) return
    if (event.altKey || event.ctrlKey || event.metaKey) return

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault()
      move(1)
      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault()
      move(-1)
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      focus(0)
      return
    }

    if (event.key !== "End") return
    event.preventDefault()
    focus(count() - 1)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return

    if (optIndex === options().length) {
      customOpen()
      return
    }

    const opt = options()[optIndex]
    if (!opt) return
    if (multi()) {
      setStore("editing", false)
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  const resizeInput = (el: HTMLTextAreaElement) => {
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }

  const focusCustom = (el: HTMLTextAreaElement) => {
    setTimeout(() => {
      el.focus()
      resizeInput(el)
    }, 0)
  }

  const toggleCustomMark = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    customToggle()
  }

  return (
    <div class="octo-question-dock">
      <DockPrompt
        kind="question"
        onKeyDown={nav}
        header={
          <>
            <div data-slot="question-header-title">{summary()}</div>
            <div data-slot="question-progress">
              <For each={questions()}>
                {(_, i) => (
                  <button
                    type="button"
                    data-slot="question-progress-segment"
                    data-active={i() === store.tab}
                    data-answered={answered(i())}
                    disabled={sending()}
                    onClick={() => jump(i())}
                    aria-label={`${props.labels.questions} ${i() + 1}`}
                  />
                )}
              </For>
            </div>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={sending()} onClick={reject} aria-keyshortcuts="Escape">
              {props.labels.dismiss}
            </Button>
            <div data-slot="question-footer-actions">
              <Show when={store.tab > 0}>
                <Button variant="secondary" size="large" disabled={sending()} onClick={back}>
                  {props.labels.back}
                </Button>
              </Show>
              <Button
                variant={last() ? "primary" : "secondary"}
                size="large"
                disabled={sending()}
                onClick={next}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                {last() ? props.labels.submit : props.labels.next}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="question-text">{question()?.question}</div>
        <div data-slot="question-hint">{multi() ? props.labels.multiHint : props.labels.singleHint}</div>
        <div data-slot="question-options">
          <For each={options()}>
            {(opt, i) => (
              <Option
                multi={multi()}
                picked={picked(opt.label)}
                label={opt.label}
                description={opt.description}
                disabled={sending()}
                ref={(el) => (optsRef[i()] = el)}
                onFocus={() => setStore("focus", i())}
                onClick={() => selectOption(i())}
              />
            )}
          </For>

          <Show when={allowCustom()}>
            <Show
              when={store.editing}
              fallback={
                <button
                  type="button"
                  ref={customRef}
                  data-slot="question-option"
                  data-custom="true"
                  data-picked={on()}
                  role={multi() ? "checkbox" : "radio"}
                  aria-checked={on()}
                  disabled={sending()}
                  onFocus={() => setStore("focus", options().length)}
                  onClick={customOpen}
                >
                  <Mark multi={multi()} picked={on()} onClick={toggleCustomMark} />
                  <span data-slot="question-option-main">
                    <span data-slot="option-label">{props.labels.typeOwnAnswer}</span>
                    <span data-slot="option-description">{input() || props.labels.customPlaceholder}</span>
                  </span>
                </button>
              }
            >
              <form
                data-slot="question-option"
                data-custom="true"
                data-picked={on()}
                role={multi() ? "checkbox" : "radio"}
                aria-checked={on()}
                onMouseDown={(e) => {
                  if (sending()) {
                    e.preventDefault()
                    return
                  }
                  if (e.target instanceof HTMLTextAreaElement) return
                  const el = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
                  if (el instanceof HTMLTextAreaElement) el.focus()
                }}
                onSubmit={(e) => {
                  e.preventDefault()
                  commitCustom()
                }}
              >
                <Mark multi={multi()} picked={on()} onClick={toggleCustomMark} />
                <span data-slot="question-option-main">
                  <span data-slot="option-label">{props.labels.typeOwnAnswer}</span>
                  <textarea
                    ref={focusCustom}
                    data-slot="question-custom-input"
                    placeholder={props.labels.customPlaceholder}
                    value={input()}
                    rows={1}
                    disabled={sending()}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault()
                        setStore("editing", false)
                        focus(options().length)
                        return
                      }
                      if ((e.metaKey || e.ctrlKey) && !e.altKey) return
                      if (e.key !== "Enter" || e.shiftKey) return
                      e.preventDefault()
                      commitCustom()
                    }}
                    onInput={(e) => {
                      customUpdate(e.currentTarget.value)
                      resizeInput(e.currentTarget)
                    }}
                  />
                </span>
              </form>
            </Show>
          </Show>
        </div>
      </DockPrompt>
    </div>
  )
}

/** 数据层:订阅当前会话(含 task 子会话)的待答 question,回答走 SDK。 */
export function InsightQuestionDock(props: { sessionID?: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const request = createMemo((): QuestionRequest | undefined =>
    sessionQuestionRequest(sync.data.session, sync.data.question, props.sessionID),
  )

  const [state, setState] = createStore({ sending: false })

  const fail = (err: unknown) => {
    const description = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description })
  }

  const reply = (req: QuestionRequest, answers: QuestionAnswer[]) => {
    if (state.sending) return
    setState("sending", true)
    console.log("[octo:question] reply", { questionID: req.id, count: answers.length })
    sdk.client.question
      .reply({ requestID: req.id, answers })
      .catch(fail)
      .finally(() => setState("sending", false))
  }

  const reject = (req: QuestionRequest) => {
    if (state.sending) return
    setState("sending", true)
    console.log("[octo:question] reject", { questionID: req.id })
    sdk.client.question
      .reject({ requestID: req.id })
      .catch(fail)
      .finally(() => setState("sending", false))
  }

  return (
    <Show when={request()} keyed>
      {(req) => (
        <QuestionDockView
          questions={[...req.questions]}
          cacheKey={req.id}
          busy={state.sending}
          labels={{
            dismiss: language.t("ui.common.dismiss"),
            back: language.t("ui.common.back"),
            next: language.t("ui.common.next"),
            submit: language.t("ui.common.submit"),
            typeOwnAnswer: language.t("ui.messagePart.option.typeOwnAnswer"),
            customPlaceholder: language.t("ui.question.custom.placeholder"),
            singleHint: language.t("ui.question.singleHint"),
            multiHint: language.t("ui.question.multiHint"),
            questions: language.t("ui.tool.questions"),
            progress: (current, total) => language.t("session.question.progress", { current, total }),
          }}
          onReply={(answers) => reply(req, answers)}
          onReject={() => reject(req)}
        />
      )}
    </Show>
  )
}
