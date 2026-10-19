import { useServer, type WorkspaceKind } from "@/context/server"
import { useProjectDir } from "@/hooks/use-project-dir"
import { kindOf } from "@/components/workspace-switcher"

/**
 * 当前工作区的分类标记。
 * "code"(代码类型): session 只隔离对话不隔离产物 —— 产物落项目根、上传/标注走 .octo/uploads|.octo/comments,
 * 全部通过 API 的 scope=project 参数表达;缺省 "normal" 走 session 隔离布局。
 */
export function useWorkspaceKind() {
  const server = useServer()
  const dir = useProjectDir({ mode: "project" })
  return (): WorkspaceKind => {
    const current = dir()
    if (!current) return "normal"
    return kindOf(server.projects.list().find((p) => p.worktree === current))
  }
}
