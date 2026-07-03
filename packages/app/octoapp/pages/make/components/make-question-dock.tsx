import { createMemo } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { QuickBriefFormView } from "./quick-brief-form"
import type { QuestionRequest, QuestionAnswer } from "@opencode-ai/sdk/v2"
import type { QuestionForm, FormQuestion } from "../utils/question-form"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

/**
 * 把 SDK 的 QuestionRequest 转换为 make 页面的 QuestionForm
 * QuickBriefFormView 使用 QuestionForm 结构
 */
function requestToForm(request: QuestionRequest, t: (key: string) => string): QuestionForm {
  return {
    id: request.id,
    title: t("ui.question.title") || "请回答以下问题",
    questions: request.questions.map(
      (q, index): FormQuestion => ({
        id: `q${index}`,
        label: q.header,
        help: q.question,
        type: q.multiple ? "checkbox" : "radio",
        options: q.options?.map((opt) => ({
          label: opt.label,
          value: opt.label,
          description: opt.description,
        })),
        required: true,
        // SDK Info.custom 默认 true(undefined 视为允许);仅 false 时关闭
        allowCustom: q.custom !== false,
      }),
    ),
  }
}

/**
 * MakeQuestionDock - /make 页面的 question 工具响应 UI
 * 复用 QuickBriefFormView 表单组件，适配数据结构
 */
export function MakeQuestionDock(props: { request: QuestionRequest; onSubmitted?: () => void }) {
  const sdk = useSDK()
  const language = useLanguage()
  const form = createMemo(() => requestToForm(props.request, language.t))

  const replyMutation = useMutation(() => ({
    mutationFn: async (answersRecord: Record<string, string | string[]>) => {
      // 把 Record<id, value> 按顺序转换为 QuestionAnswer[]
      const answers: QuestionAnswer[] = props.request.questions.map((_, index) => {
        const v = answersRecord[`q${index}`]
        return Array.isArray(v) ? v : v ? [v] : []
      })
      await sdk.client.question.reply({ requestID: props.request.id, answers })
    },
    onSuccess: () => {
      props.onSubmitted?.()
    },
    onError: (err) => {
      console.error("[MakeQuestionDock] reply error:", err)
    },
  }))

  return (
    <QuickBriefFormView
      form={form()}
      onSubmit={(_text, answers) => {
        replyMutation.mutate(answers)
      }}
    />
  )
}