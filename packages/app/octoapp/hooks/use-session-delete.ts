import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { sessionErrorMessage } from "@/utils/session-delete"

/**
 * Shared session-delete action: calls `client.session.delete`, surfaces a
 * localized toast on failure, and resolves to a success boolean so callers
 * can branch (e.g. skip store/navigation updates on failure).
 *
 * Encapsulates the duplicated `.then(x => x.data).catch(showToast + false)`
 * pattern previously inlined across chat / insight / design / studio deletes.
 */
export function useSessionDelete() {
  const language = useLanguage()
  return (client: OpencodeClient, sessionID: string): Promise<boolean> =>
    client.session
      .delete({ sessionID })
      .then((x) => !!x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: sessionErrorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
}
