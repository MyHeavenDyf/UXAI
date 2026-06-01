import { type Component, type JSX } from "solid-js"

export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>{props.children}</div>
}
