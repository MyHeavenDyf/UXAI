import { useCommand, type CommandOption } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useNavigate } from "@solidjs/router"
import { onCleanup } from "solid-js"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

/**
 * Register Make page slash commands
 * 
 * Commands registered:
 * - /new - New session
 * - /undo - Undo last message
 * - /redo - Redo undone message
 * - /compact - Compact session
 * - /agent - Switch agent
 * - /mcp - Open MCP settings
 */
export function useMakeCommands() {
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()

  const sessionCommand = withCategory(language.t("command.category.session"))

  const commands = () => [
    sessionCommand({
      id: "make.new",
      title: language.t("command.session.new"),
      slash: "new",
      onSelect: () => navigate("/make"),
    }),

    sessionCommand({
      id: "make.undo",
      title: language.t("command.session.undo"),
      slash: "undo",
      onSelect: () => {
        // TODO: Implement undo logic
      },
    }),

    sessionCommand({
      id: "make.redo",
      title: language.t("command.session.redo"),
      slash: "redo",
      onSelect: () => {
        // TODO: Implement redo logic
      },
    }),

    sessionCommand({
      id: "make.compact",
      title: language.t("command.session.compact"),
      slash: "compact",
      onSelect: () => {
        // TODO: Implement compact logic
      },
    }),

    sessionCommand({
      id: "make.agent",
      title: language.t("command.agent.choose"),
      slash: "agent",
      onSelect: () => {
        // TODO: Implement agent selector
      },
    }),

    sessionCommand({
      id: "make.mcp",
      title: language.t("command.mcp.settings"),
      slash: "mcp",
      onSelect: () => {
        // TODO: Implement MCP settings dialog
      },
    }),
  ]

  command.register("make", commands)
}