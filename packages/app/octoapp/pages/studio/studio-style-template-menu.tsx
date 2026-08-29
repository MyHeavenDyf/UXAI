import { createSignal, type JSX } from "solid-js"

type StyleTemplateSection = "creative-square" | "mine"

export function StudioStyleTemplateMenu(props: { onCreateTemplate: () => void }): JSX.Element {
  const [section, setSection] = createSignal<StyleTemplateSection>("creative-square")

  return (
    <div class="studio-menu studio-style-template-menu">
      <div class="studio-style-template-header">
        <div class="studio-style-template-tabs" role="tablist" aria-label="风格模板分类">
          <button
            type="button"
            role="tab"
            aria-selected={section() === "creative-square"}
            class="studio-style-template-tab"
            classList={{ active: section() === "creative-square" }}
            onClick={() => setSection("creative-square")}
          >
            创意广场
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section() === "mine"}
            class="studio-style-template-tab"
            classList={{ active: section() === "mine" }}
            onClick={() => setSection("mine")}
          >
            我的模板
          </button>
        </div>
        <button type="button" class="studio-style-template-create" onClick={props.onCreateTemplate}>
          <span class="studio-style-template-create-plus" aria-hidden="true" />
          <span>创建模板</span>
        </button>
      </div>
      <div class="studio-style-template-content" role="tabpanel" />
    </div>
  )
}
