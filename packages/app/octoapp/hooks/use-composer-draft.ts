import { createMemo, untrack } from "solid-js"
import {
  disposeAttachments,
  draftFiles,
  dropDraft,
  readDraft,
  registerDraftScope,
  renameDraft,
  writeDraft,
  type ComposerDraft,
  type DraftAttachment,
  type DraftPersist,
} from "@/utils/composer-draft"

/**
 * 输入区草稿 —— 页面唯一入口(存储层见 utils/composer-draft)
 *
 * 返回的 accessor / setter 与 createSignal 同签名,页面把原来的
 *   const [prompt, setPrompt] = createSignal("")
 * 换成本 hook 即可,其余调用点一行不用改。
 *
 * 三件页面容易忽略、但改成「草稿保留」后必须处理的事:
 *   ① 异步上传的回调要写回**发起时那个桶**(用户可能已经切走),用 key() 快照 + updateAttachments(owner);
 *   ② 欢迎页发第一条时会现建会话,得在 navigate 之前 rename() 整桶改名,附件与常驻附加态才跟得过去;
 *   ③ objectURL 与原 File 引用不再随组件卸载消失,删附件 / 发送消费 / 桶被淘汰都要 dispose()。
 */

/** 尚未建会话(欢迎页)时的桶名 */
const NEW_SESSION_BUCKET = "__new__"

export type ComposerDraftOptions<A extends DraftAttachment, E> = {
  /** 模块名,既是桶 key 前缀也是落盘命名空间(如 "insight") */
  scope: string
  /** 当前会话 id;undefined = 尚未建会话,用独立的 __new__ 桶 */
  session: () => string | undefined
  /** 附加输入态的空值(insight = null 的 MCP chip);正文空 + 无附件 + extra 回到它 = 空草稿,自动删桶 */
  emptyExtra: E
  /** 不传 = 该模块草稿纯内存(切会话 / 切 tab 保留,整页刷新重置) */
  persist?: DraftPersist<A, E>
}

export function useComposerDraft<A extends DraftAttachment, E>(options: ComposerDraftOptions<A, E>) {
  registerDraftScope(options.scope, options.persist)

  // 稳定空草稿:无桶时恒返回同一引用,避免每次读都吐新对象导致下游 memo 空转
  const empty: ComposerDraft<A, E> = { text: "", attachments: [], extra: options.emptyExtra }

  const keyOf = (session: string | undefined) => `${options.scope}/${session || NEW_SESSION_BUCKET}`
  const key = () => keyOf(options.session())

  const read = (bucket: string) => (readDraft(bucket) as ComposerDraft<A, E> | undefined) ?? empty
  const peek = (bucket: string) => untrack(() => read(bucket))

  const blank = (draft: ComposerDraft<A, E>) =>
    draft.text === "" && draft.attachments.length === 0 && draft.extra === options.emptyExtra

  const write = (bucket: string, next: ComposerDraft<A, E>) => {
    if (blank(next)) dropDraft(bucket)
    else writeDraft(bucket, next as ComposerDraft<DraftAttachment>)
  }

  const patch = (bucket: string, update: (draft: ComposerDraft<A, E>) => ComposerDraft<A, E>) => {
    write(bucket, update(peek(bucket)))
  }

  const current = createMemo(() => read(key()))

  return {
    /** 当前桶 key —— 异步任务(上传 / 导入)发起时快照它,回调用它写回,别用「当时的当前桶」 */
    key,
    keyOf,

    text: createMemo(() => current().text),
    attachments: createMemo(() => current().attachments),
    extra: createMemo(() => current().extra),

    setText(value: string | ((current: string) => string)) {
      patch(key(), (draft) => ({
        ...draft,
        text: typeof value === "function" ? value(draft.text) : value,
      }))
    },

    setAttachments(value: A[] | ((current: A[]) => A[])) {
      patch(key(), (draft) => ({
        ...draft,
        attachments: typeof value === "function" ? value(draft.attachments) : value,
      }))
    },

    setExtra(value: E) {
      patch(key(), (draft) => ({ ...draft, extra: value }))
    },

    /** 更新指定桶的附件(异步上传回调专用:发起时的桶未必还是当前桶) */
    updateAttachments(owner: string, update: (current: A[]) => A[]) {
      patch(owner, (draft) => ({ ...draft, attachments: update(draft.attachments) }))
    },

    /** 只读快照指定桶的附件(发送时取,不建立反应式依赖) */
    attachmentsOf(owner: string) {
      return peek(owner).attachments
    },

    /** 整桶改名(欢迎页桶 → 刚建出来的会话桶) */
    rename: renameDraft,

    /** 发送消费:清空该桶附件并释放资源;正文与附加态不动(如 insight 的 chip 是常驻模式) */
    consumeAttachments(owner: string) {
      const draft = peek(owner)
      if (draft.attachments.length === 0) return
      disposeAttachments(draft.attachments)
      write(owner, { ...draft, attachments: [] })
    },

    /** 释放一批附件的 objectURL 与原 File 引用(删除单个附件时用) */
    dispose: disposeAttachments,

    /** 附件原 File 引用表(重传用) */
    files: draftFiles,
  }
}
