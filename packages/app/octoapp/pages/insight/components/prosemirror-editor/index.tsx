import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js"
import { Portal } from "solid-js/web"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Slice, Fragment } from "prosemirror-model"
import { buildParagraphs, validTrigger, nextInsertPos } from "../../utils/mention"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { editorSchema, getDocTextWithMentions, extractMentionsFromDoc, type MentionAttrs } from "./schema"
import { createMentionTriggerPlugin, mentionTriggerKey, type MentionTriggerState } from "./plugins/mention-trigger"
import { createSyncPlugin } from "./plugins/sync"
import { atomKeymap } from "./plugins/atom-keymap"
import { MentionPopover, type MentionSelection, type MentionSkill, type MentionFiles } from "../mention-popover"
import "./styles.css"

// SPEC-INS-023 方案 B:insight 输入框换成 ProseMirror,拿到行内灰胶囊(@提及原子节点)。
// 本地化自 Design/make 的 prosemirror-editor:去掉 slash-trigger（/ 不做）与 /preview；
// 接 insight 的 MentionPopover（octo_insight 技能 + insight 会话文件）。
// 3b 注入不变：编辑器只负责「文本 + 提及」的采集,发送时的 SKILL.md / [引用文件] synthetic 注入在 index.tsx。

export interface InsightEditorRef {
  getText: () => string
  getMentions: () => Array<{ name: string; type: string; label: string; path?: string }>
  focus: () => void
  clear: () => void
  /** 覆盖式回填「文本 + 引用」(排队项回填):按 @名 重建 mention 胶囊,selections 由 syncPlugin 自动派生 */
  setContent: (text: string, mentions: MentionAttrs[]) => void
}


interface Props {
  platformSkills: MentionSkill[]
  customSkills: MentionSkill[]
  files: MentionFiles | null
  /** 技能 / 文件是否仍在拉取:透传给面板区分「加载中」与「暂无」 */
  skillsLoading?: boolean
  filesLoading?: boolean
  mentionSelections: MentionSelection[]
  setMentionSelections: (selections: MentionSelection[]) => void
  disabled?: boolean
  /** 挂载后自动聚焦(新建对话页 / 进入会话就能直接打字;旧 textarea 时代没做,换 PM 后一并补上) */
  autofocus?: boolean
  placeholder?: string
  onSubmit?: () => void
  onTriggerMention?: () => void
  onContentChange?: (text: string) => void
  /** 面板由关到开那一次(打点 mention-open) */
  onMentionOpen?: () => void
  /** 选中一项(打点 mention-select) */
  onMentionSelect?: (selection: MentionSelection) => void
  /** 粘贴事件透传(insight 用于拦截图片/文件粘贴进附件;文本粘贴不拦,交给编辑器) */
  onPaste?: (e: ClipboardEvent) => void
  ref?: (el: InsightEditorRef) => void
}

export function ProseMirrorEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined
  const [view, setView] = createSignal<EditorView>()
  const [triggerState, setTriggerState] = createSignal<MentionTriggerState | null>(null)
  const [isEmpty, setIsEmpty] = createSignal(true)
  // 弹层用 Portal 挂到 body + fixed 定位(对齐 Design a919045a2):脱离胶囊 overflow/堆叠上下文,
  // 永不被裁切/遮挡 → 胶囊可保留 overflow-hidden(圆角)。坐标从编辑器容器实时算。
  const [popoverPos, setPopoverPos] = createSignal<{ left: number; bottom: number } | null>(null)

  // 打点去重:一次 @ 输入过程只报一次 open。
  // 不能拿 triggerState 的 active 当判据 —— 点面板外关闭只置空了本地 state,文本里的 @query 还在,
  // 之后每敲一个字插件都会判成「由关到开」再报一次。以 @ 触发文本真正消失(插件回调传 null)为重置点。
  let openReported = false
  // 多选模式:本轮是否插入过文件胶囊(决定关闭时是否清理 @query)。插入位点不维护可变计数器,
  // 每次插入前用 nextInsertPos(doc, trigger) 现算 —— 对 query 变化 / deselect / undo 全免疫
  let insertedThisRound = false
  const resetRound = () => {
    insertedThisRound = false
  }
  const mentionTriggerPlugin = createMentionTriggerPlugin((state) => {
    const prev = triggerState()
    setTriggerState(state)
    if (state?.active && containerRef) {
      const rect = containerRef.getBoundingClientRect()
      setPopoverPos({ left: rect.left, bottom: window.innerHeight - rect.top })
    } else {
      setPopoverPos(null)
    }
    // 失活清理:仅本轮插入过胶囊时才删残留 @query(纯手打 @文字视为正文保留);validTrigger 守卫防位置漂移致越界
    if (!state && prev?.active) {
      const v = view()
      const tv = v ? validTrigger(v.state.doc, prev) : null
      if (v && tv && insertedThisRound && tv.to !== v.state.selection.from) {
        v.dispatch(v.state.tr.delete(tv.from, tv.to))
      }
      resetRound()
    }
    if (!state?.active) {
      openReported = false
    } else if (!openReported) {
      openReported = true
      props.onMentionOpen?.()
    }
  }, props.onTriggerMention)

  const syncPlugin = createSyncPlugin((mentions: MentionAttrs[], empty: boolean) => {
    const selections: MentionSelection[] = mentions.map((m) =>
      m.type === "skill"
        ? { type: "skill", name: m.name, label: m.label }
        : { type: "file", filename: m.name, path: m.path || "" },
    )
    props.setMentionSelections(selections)
    setIsEmpty(empty)
  }, props.onContentChange)

  const connected = (v: EditorView | undefined): v is EditorView => !!v && !!v.dom?.isConnected

  onMount(() => {
    if (!containerRef) return

    const state = EditorState.create({
      schema: editorSchema,
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-shift-z": redo,
          Enter: (state) => {
            if (props.disabled) return false
            // @ 面板打开时 Enter 用于确认选中项,不发送消息(与 Slack / Notion / GitHub 一致)
            if (mentionTriggerKey.getState(state)?.active) return false
            props.onSubmit?.()
            return true
          },
          // 换行插 hard_break:schema 无 hard_break 时 baseKeymap 接不住 Shift-Enter,换行会整个丢掉
          "Shift-Enter": (state, dispatch) => {
            if (props.disabled) return false
            if (dispatch) dispatch(state.tr.replaceSelectionWith(editorSchema.nodes.hard_break.create()))
            return true
          },
        }),
        keymap(baseKeymap),
        atomKeymap,
        mentionTriggerPlugin,
        syncPlugin,
      ],
    })

    const editorView = new EditorView(containerRef, {
      state,
      dispatchTransaction: (tr: Transaction) => {
        const newState = editorView.state.apply(tr)
        editorView.updateState(newState)
      },
      editable: () => !props.disabled,
      // 粘贴一律走 text/plain:本编辑器只承载纯文本 + mention 胶囊,富文本格式一概接不住。
      // 默认行为会优先解析 text/html,而从消息气泡复制出来的 HTML 里换行是裸 \n
      // (气泡靠 white-space: pre-wrap 才显示成多行),DOMParser 在 preserveWhitespace: false 下
      // 按 HTML 空白规则把它折叠成空格 —— 表现为「从气泡复制的多行,粘进来变一行」。
      handlePaste: (view, event) => {
        // 图片 / 文件粘贴不归这里管,交给外层 onPaste 走附件上传
        if (Array.from(event.clipboardData?.items ?? []).some((i) => i.kind === "file")) return false
        const text = event.clipboardData?.getData("text/plain")
        if (!text) return false
        // openStart/openEnd = 1:段落两端保持开放,粘到段落中间时首尾会与原内容合并而不是硬切成新段
        const slice = new Slice(Fragment.from(buildParagraphs(text, [])), 1, 1)
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      },
    })

    setView(editorView)

    props.ref?.({
      getText: () => (connected(view()) ? getDocTextWithMentions(view()!.state.doc) : ""),
      getMentions: () => (connected(view()) ? extractMentionsFromDoc(view()!.state.doc) : []),
      focus: () => {
        if (connected(view())) view()!.focus()
      },
      clear: () => {
        const v = view()
        if (!connected(v)) return
        v.dispatch(v.state.tr.delete(0, v.state.doc.content.size))
      },
      setContent: (text: string, mentions: MentionAttrs[]) => {
        const v = view()
        if (!connected(v)) return
        const paragraphs = buildParagraphs(text, mentions)
        const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, paragraphs)
        // 光标落到末尾,接着改就行
        tr.setSelection(TextSelection.atEnd(tr.doc))
        v.dispatch(tr)
      },
    })

    // 自动聚焦放到下一帧:此刻 DOM 刚插入,同帧 focus() 会被随后的布局/父级渲染抢掉
    if (props.autofocus && !props.disabled) {
      requestAnimationFrame(() => {
        if (connected(editorView)) editorView.focus()
      })
    }

    onCleanup(() => editorView.destroy())
  })

  // disabled 变化时同步 editable
  createEffect(() => {
    const v = view()
    if (!v) return
    const isEditable = !props.disabled
    if (v.editable !== isEditable) v.setProps({ ...v.props, editable: () => isEditable })
  })

  // 关闭 @ 面板:先置空本地 state 再 dispatch,避免 dispatch 触发的 onChange(null) 拿到失效 prev 越界;
  // 仅本轮插入过胶囊才删 @query(纯手打 @文字保留),用 validTrigger 守卫真实区间
  const closeMention = () => {
    const v = view()
    const trigger = v ? validTrigger(v.state.doc, triggerState()) : null
    const clearQuery = insertedThisRound && !!trigger
    setTriggerState(null)
    resetRound()
    if (v) {
      const tr = v.state.tr.setMeta(mentionTriggerKey, null)
      if (clearQuery && trigger) tr.delete(trigger.from, trigger.to)
      v.dispatch(tr)
    }
  }

  // 点击面板外关闭
  createEffect(() => {
    if (!triggerState()?.active) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(".ins-pm-editor")) return
      if (!target.closest(".ins-mention-container")) closeMention()
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  // 选中:把触发区间的 @query 替换成 mention 原子节点(灰胶囊);selections 由 syncPlugin 从 doc 派生
  const handleMentionSelect = (selection: MentionSelection) => {
    const v = view()
    if (!v) return
    const trigger = validTrigger(v.state.doc, triggerState())
    if (!trigger) return

    const attrs =
      selection.type === "skill"
        ? { id: selection.name, name: selection.name, type: "skill" as const, label: selection.label, path: "" }
        : { id: selection.filename, name: selection.filename, type: "file" as const, label: selection.filename, path: selection.path }

    const node = editorSchema.nodes.mention.create(attrs)
    // 文件走多选:在 @query 后(光标处)插入胶囊,保留 @query 与浮窗以继续选择下一项;
    // 技能走单选:把 @query 替换成胶囊并关闭浮窗。
    if (selection.type === "file") {
      // 插入位点用扫描法现算:从 trigger.to 起跳过已有 mention + 配对空格,落在序列末尾
      // (对 query 变化 / deselect / undo 免疫,不依赖可变计数器);胶囊间补空格分隔避免粘连
      const insertAt = nextInsertPos(v.state.doc, trigger)
      const tr = v.state.tr.insert(insertAt, node)
      tr.insert(insertAt + node.nodeSize, editorSchema.text(" "))
      tr.setSelection(TextSelection.create(tr.doc, trigger.to))
      v.dispatch(tr)
      insertedThisRound = true
      v.focus()
      props.onMentionSelect?.(selection)
      return
    }
    const tr = v.state.tr.replaceWith(trigger.from, trigger.to, node)
    tr.setSelection(TextSelection.create(tr.doc, trigger.from + node.nodeSize))
    v.dispatch(tr)
    setTriggerState(null)
    v.focus()
    props.onMentionSelect?.(selection)
  }

  // 取消:删掉对应 mention 节点;技能额外清掉 @query 并关闭浮窗,文件保留 @query 与浮窗以继续多选
  const handleMentionDeselect = (selection: MentionSelection) => {
    const v = view()
    if (!v) return
    const name = selection.type === "skill" ? selection.name : selection.filename
    const path = selection.type === "file" ? selection.path : ""
    const trigger = triggerState()

    // 收集要删的胶囊(原 doc 坐标)倒序删除,避免累积 delete 致后续节点位置漂移;
    // 文件按 name+path 区分,避免同名不同目录被一起删;同时删 mention 后配对的空格,避免残留致扫描位点错乱
    const hits: Array<{ pos: number; end: number }> = []
    v.state.doc.descendants((node, pos) => {
      if (node.type.name !== "mention" || node.attrs.name !== name) return
      if (selection.type === "file" ? node.attrs.path !== path : node.attrs.type !== "skill") return
      let end = pos + node.nodeSize
      const after = v.state.doc.resolve(end).nodeAfter
      if (after && after.isText && after.text === " ") end += after.nodeSize
      hits.push({ pos, end })
    })
    const tr1 = v.state.tr
    for (let i = hits.length - 1; i >= 0; i--) tr1.delete(hits[i].pos, hits[i].end)

    if (selection.type === "file") {
      if (tr1.docChanged) v.dispatch(tr1)
      // 用 mapping 把 trigger.to 映射到删胶囊后的新位置,TextSelection.near 取就近的合法 inline 位点
      if (trigger) {
        const mappedTo = tr1.docChanged ? tr1.mapping.map(trigger.to) : trigger.to
        const safe = Math.min(Math.max(mappedTo, 0), v.state.doc.content.size)
        v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(safe))))
      }
      resetRound()
      return
    }

    // 技能取消:删对应胶囊后,用 validTrigger 在删后 doc 上校验并精确删 @query
    // (老正则估算会被中间 mention 的空文本带偏起点、误删胶囊),setMeta null 关浮窗
    const tv = validTrigger(tr1.doc, trigger)
    if (tv) tr1.delete(tv.from, tv.to)
    tr1.setMeta(mentionTriggerKey, null)
    v.dispatch(tr1)
    setTriggerState(null)
    resetRound()
  }

  return (
    <div class="ins-pm-editor-wrapper">
      <Show when={isEmpty() && !props.disabled && props.placeholder}>
        <div class="ins-pm-placeholder">{props.placeholder}</div>
      </Show>
      <div
        ref={containerRef}
        class="ins-pm-editor octo-input-scroll"
        classList={{ "ins-pm-editor--disabled": props.disabled }}
        onPaste={(e) => props.onPaste?.(e)}
      />

      <Show when={triggerState()?.active && popoverPos()}>
        <Portal>
          <div
            style={{
              position: "fixed",
              left: `${popoverPos()!.left}px`,
              bottom: `${popoverPos()!.bottom + 12}px`,
              "z-index": 1000,
            }}
          >
            <MentionPopover
              query={triggerState()!.query}
              platformSkills={props.platformSkills}
              customSkills={props.customSkills}
              files={props.files}
              skillsLoading={props.skillsLoading}
              filesLoading={props.filesLoading}
              selections={props.mentionSelections}
              onSelect={handleMentionSelect}
              onDeselect={handleMentionDeselect}
              onClose={closeMention}
            />
          </div>
        </Portal>
      </Show>
    </div>
  )
}

export { getDocTextWithMentions, extractMentionsFromDoc }
export type { MentionAttrs }
