import { useMutation } from "@tanstack/solid-query"
import type { QuestionRequest, QuestionAnswer } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { QuestionDockView } from "../../insight/components/question-dock"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

/** Design 的 question 工具复用 insight 展示层，保持所有样式及滚动行为一致。 */
export function MakeQuestionDock(props: { request: QuestionRequest; onSubmitted?: () => void }) {
  const sdk = useSDK()
  const language = useLanguage()

  const response = useMutation(() => ({
    mutationFn: async (answers: QuestionAnswer[] | undefined) => {
      if (answers === undefined) {
        await sdk.client.question.reject({ requestID: props.request.id })
        return
      }
      await sdk.client.question.reply({ requestID: props.request.id, answers })
    },
    onSuccess: () => {
      props.onSubmitted?.()
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  return (
    <QuestionDockView
      questions={props.request.questions}
      cacheKey={props.request.id}
      busy={response.isPending}
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
      onReply={(answers) => response.mutate(answers)}
      onReject={() => response.mutate(undefined)}
    />
  )
}
