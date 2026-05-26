import { type Component, type JSX } from "solid-js"

export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div class="flex flex-col gap-3">{props.children}</div>
}
