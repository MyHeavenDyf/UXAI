import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"

export type StudioCanvasView = "canvas" | "file-manager" | "template-creator"
export type StudioStyleDimensionId =
  | "tonal"
  | "composition"
  | "volume"
  | "surface"
  | "color"
  | "linework"
  | "shape_structure"
  | "role_design"
  | "lettering"
  | "post_processing"
export type TemplateUploadImage = {
  url: string
}
export type StudioStyleDescriptionGenerateInput = {
  style_keywords: string
  style_images: TemplateUploadImage[]
  style_dimensions: StudioStyleDimensionId[]
}
export type StudioStyleDescriptionStreamEvent = {
  type: string
  content?: string
}
export type StudioStyleDescriptionGenerateHandlers = {
  onEvent: (event: StudioStyleDescriptionStreamEvent) => void
  signal?: AbortSignal
}

type TemplateCreatorCategory = "extract_style" | "preset_recipe"
type TemplateCreatorStep = "make" | "publish" | "examples"
type StyleDescriptionStreamField = "overview" | StudioStyleDimensionId
type StyleDescriptionStreamPhase = "idle" | "extracting" | "summarizing" | "done" | "error"
type PromptSetting = "required" | "optional" | "not_supported"
type ReferenceMode = "fixed" | "optional" | "not_supported"
type ReferenceCount = 1 | 2 | 3
type TemplateVisibility = "all_users" | "specified_users"
type TemplateCreatorSelectOption<T extends string> = {
  value: T
  label: string
}
type StudioTemplateStyleDescription = {
  overview: string
} & Partial<Record<StudioStyleDimensionId, string>>

type StudioTemplatePublishBaseInput = {
  allowed_user_id: string | null
  creator_user_id?: string
  example_images: TemplateUploadImage[]
  permission_type: TemplateVisibility
  prompt_setting: PromptSetting
  reference_image_count: 0 | ReferenceCount
  reference_image_setting: ReferenceMode
  template_type: TemplateCreatorCategory
  title: string
  usage_instructions: string
}

export type StudioTemplatePublishInput =
  | (StudioTemplatePublishBaseInput & {
    template_type: "extract_style"
    style_description: StudioTemplateStyleDescription
    style_images: TemplateUploadImage[]
    style_keywords: string
  })
  | (StudioTemplatePublishBaseInput & {
    template_type: "preset_recipe"
    fixed_reference_images: TemplateUploadImage[]
    play_description: string
  })

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const ACCEPTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i
const TITLE_MAX_LENGTH = 10
const TITLE_MIN_LENGTH = 5
const DESCRIPTION_ITEM_MAX_LENGTH = 300
const DESCRIPTION_TOTAL_MAX_LENGTH = 700
const BYTES_IN_MB = 1024 * 1024
const DEFAULT_RECIPE_PLACEHOLDER = "输入玩法提示词"

const PROMPT_SETTING_OPTIONS = [
  { value: "required", label: "必填提示词" },
  { value: "optional", label: "选填提示词" },
  { value: "not_supported", label: "不支持提示词" },
] satisfies TemplateCreatorSelectOption<PromptSetting>[]

const REFERENCE_MODE_OPTIONS = [
  { value: "fixed", label: "固定参考图" },
  { value: "optional", label: "选填参考图" },
  { value: "not_supported", label: "不支持参考图" },
] satisfies TemplateCreatorSelectOption<ReferenceMode>[]

const REFERENCE_COUNT_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
] satisfies TemplateCreatorSelectOption<`${ReferenceCount}`>[]

const STYLE_DIMENSIONS = [
  {
    id: "tonal",
    label: "明暗",
    placeholder: "描述图片的明暗特征，包括整体亮度倾向、对比范围、层次丰富程度。",
  },
  {
    id: "composition",
    label: "构图",
    placeholder: "描述图片的构图特征，包括透视类型、背景处理方式、负空间、景深、视觉层级，以及画面的整体节奏感。",
  },
  {
    id: "volume",
    label: "体积感",
    placeholder: "描述图片的形体立体感，包括物体表面的过渡方式、过渡的边缘特征，以及形体边界的质量。",
  },
  {
    id: "surface",
    label: "表面质感",
    placeholder: "描述图片中物体的表面属性，包括质感、纹理特征、细节密度、工艺痕迹",
  },
  {
    id: "color",
    label: "色彩",
    placeholder: "描述图片的色彩系统，包括主导色、背景色、饱和度分布、点缀色",
  },
  {
    id: "linework",
    label: "线条",
    placeholder: "描述线条与笔触特征",
  },
  {
    id: "shape_structure",
    label: "造型特征",
    placeholder: "描述形状语言与造型构造",
  },
  {
    id: "role_design",
    label: "角色形象",
    placeholder: "描述角色或生物的造型设计，包括人物比例特征以及整体形态语言风格",
  },
  {
    id: "lettering",
    label: "字体",
    placeholder: "描述文字或者字体设计",
  },
  {
    id: "post_processing",
    label: "后期效果",
    placeholder: "描述后期处理效果",
  },
] satisfies { id: StudioStyleDimensionId; label: string; placeholder: string }[]

const DEFAULT_STYLE_DIMENSIONS: StudioStyleDimensionId[] = ["tonal", "composition", "volume", "surface"]
const STYLE_DESCRIPTION_FIELDS = new Set<StyleDescriptionStreamField>(["overview", ...STYLE_DIMENSIONS.map((dimension) => dimension.id)])

function isTemplateUploadRecord(record: { url: string; file: File } | null): record is { url: string; file: File } {
  return Boolean(record?.url)
}

function acceptedImageFile(file: File) {
  return ACCEPTED_IMAGE_TYPES.has(file.type) || ACCEPTED_IMAGE_EXTENSIONS.test(file.name)
}

function maxBytes(maxFileSizeMb: number) {
  return maxFileSizeMb * BYTES_IN_MB
}

function estimateBase64Size(url: string) {
  const base64 = url.includes(",") ? (url.split(",")[1] ?? "") : url
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function imageTotalSize(images: TemplateUploadImage[], sizeByUrl: Record<string, number>) {
  return images.reduce((sum, image) => sum + (sizeByUrl[image.url] ?? estimateBase64Size(image.url)), 0)
}

function truncateValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function isStyleDescriptionStreamField(value: string): value is StyleDescriptionStreamField {
  return STYLE_DESCRIPTION_FIELDS.has(value as StyleDescriptionStreamField)
}

function RequiredMark(): JSX.Element {
  return <span class="studio-template-creator-required">*</span>
}

function StudioTemplateCreatorIcon(props: { type: TemplateCreatorCategory }): JSX.Element {
  return (
    <span class={`studio-template-creator-category-icon ${props.type}`} aria-hidden="true">
      <Show
        when={props.type === "extract_style"}
        fallback={
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
            <path d="M10 2.5a6 6 0 0 0-3.2 11.08c.45.28.7.7.7 1.22v.2h5v-.2c0-.52.25-.94.7-1.22A6 6 0 0 0 10 2.5Z" fill="currentColor" />
            <path d="M7.75 16.25h4.5M8.5 18h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        }
      >
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none">
          <circle cx="10" cy="4.5" r="3" fill="currentColor" />
          <circle cx="10" cy="15.5" r="3" fill="currentColor" />
          <circle cx="4.5" cy="10" r="3" fill="currentColor" />
          <circle cx="15.5" cy="10" r="3" fill="currentColor" />
          <circle cx="10" cy="10" r="2.2" fill="#fff" />
        </svg>
      </Show>
    </span>
  )
}

function templateCreatorStepStatus(currentStep: TemplateCreatorStep, step: TemplateCreatorStep) {
  const stepIndex = ["make", "publish", "examples"].indexOf(step)
  const currentIndex = ["make", "publish", "examples"].indexOf(currentStep)
  if (stepIndex < currentIndex) return "complete"
  if (stepIndex === currentIndex) return "active"
  return "pending"
}

function TemplateCreatorSteps(props: { currentStep: TemplateCreatorStep }): JSX.Element {
  const steps = [
    { value: "make", label: "制作模板", index: 1 },
    { value: "publish", label: "发布模板", index: 2 },
    { value: "examples", label: "添加示例", index: 3 },
  ] satisfies { value: TemplateCreatorStep; label: string; index: number }[]

  return (
    <div class="studio-template-creator-steps" aria-label="创建模板步骤">
      <For each={steps}>
        {(step, index) => {
          const status = () => templateCreatorStepStatus(props.currentStep, step.value)
          return (
            <>
              <Show when={index() > 0}>
                <span class="studio-template-creator-step-line" />
              </Show>
              <div
                class="studio-template-creator-step"
                classList={{ active: status() === "active", complete: status() === "complete" }}
              >
                <span class="studio-template-creator-step-dot">
                  <Show when={status() === "complete"} fallback={step.index}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                      <path d="M3.5 8.2L6.4 11L12.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </Show>
                </span>
                <span class="studio-template-creator-step-label">{step.label}</span>
              </div>
            </>
          )
        }}
      </For>
    </div>
  )
}

function TemplateCreatorField(props: { title: string; required?: boolean; description?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="studio-template-creator-field">
      <div class="studio-template-creator-field-title">
        <span>{props.title}</span>
        <Show when={props.required}>
          <RequiredMark />
        </Show>
      </div>
      <Show when={props.description}>
        <div class="studio-template-creator-field-description">{props.description}</div>
      </Show>
      {props.children}
    </section>
  )
}

function TemplateCreatorTitleInput(props: { value: string; onInput: (value: string) => void }): JSX.Element {
  return (
    <div class="studio-template-creator-title-input-wrap">
      <input
        class="studio-template-creator-title-input"
        value={props.value}
        maxLength={TITLE_MAX_LENGTH}
        placeholder="描述你的模板（5-10字）"
        onInput={(event) => props.onInput(truncateValue(event.currentTarget.value, TITLE_MAX_LENGTH))}
      />
      <span class="studio-template-creator-title-count">{props.value.length}/{TITLE_MAX_LENGTH}</span>
    </div>
  )
}

function TemplateCreatorCategoryCards(props: { value: TemplateCreatorCategory; onChange: (value: TemplateCreatorCategory) => void }): JSX.Element {
  const categories = [
    {
      value: "extract_style",
      title: "提取视觉风格",
      description: "从图中提取色彩、笔触、材质和光影氛围，套用到你的新提示词上。",
    },
    {
      value: "preset_recipe",
      title: "预设灵感配方",
      description: "锁定原图的轮廓、姿势、透视和物体摆放位置，用全新的风格重绘。",
    },
  ] satisfies { value: TemplateCreatorCategory; title: string; description: string }[]

  return (
    <div class="studio-template-creator-category-list">
      <For each={categories}>
        {(category) => (
          <button
            type="button"
            class="studio-template-creator-category-card"
            classList={{ active: props.value === category.value }}
            aria-pressed={props.value === category.value}
            onClick={() => props.onChange(category.value)}
          >
            <div class="studio-template-creator-category-card-head">
              <span class="studio-template-creator-category-title-wrap">
                <StudioTemplateCreatorIcon type={category.value} />
                <span class="studio-template-creator-category-title">{category.title}</span>
              </span>
              <span class="studio-template-creator-category-radio" aria-hidden="true" />
            </div>
            <div class="studio-template-creator-category-description">{category.description}</div>
          </button>
        )}
      </For>
    </div>
  )
}

function TemplateCreatorSelect<T extends string>(props: {
  value: T
  options: TemplateCreatorSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  suffix?: string
}): JSX.Element {
  let rootRef!: HTMLDivElement
  const [open, setOpen] = createSignal(false)
  const selected = createMemo(() => props.options.find((option) => option.value === props.value) ?? props.options[0])
  const closeOnOutsidePointer = (event: PointerEvent) => {
    if (!rootRef?.contains(event.target as Node)) setOpen(false)
  }

  onMount(() => document.addEventListener("pointerdown", closeOnOutsidePointer))
  onCleanup(() => document.removeEventListener("pointerdown", closeOnOutsidePointer))

  return (
    <div ref={rootRef!} class="studio-template-creator-select" classList={{ open: open() }}>
      <button
        type="button"
        class="studio-template-creator-select-trigger"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="studio-template-creator-select-value">{selected()?.label}</span>
        <Show when={props.suffix}>
          <span class="studio-template-creator-select-suffix">{props.suffix}</span>
        </Show>
        <span class="studio-template-creator-select-arrow" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="studio-template-creator-select-menu" role="listbox" aria-label={props.ariaLabel}>
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === props.value}
                class="studio-template-creator-select-option"
                classList={{ active: option.value === props.value }}
                onClick={() => {
                  props.onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function TemplateCreatorTextarea(props: {
  label?: string
  value: string
  placeholder: string
  onInput: (value: string) => void
  maxLength?: number
  rows?: number
}): JSX.Element {
  const maxLength = () => props.maxLength ?? DESCRIPTION_ITEM_MAX_LENGTH
  return (
    <div class="studio-template-creator-textarea-block">
      <Show when={props.label}>
        <div class="studio-template-creator-textarea-head">
          <span class="studio-template-creator-textarea-label">{props.label}</span>
          <span class="studio-template-creator-textarea-count">{props.value.length}/{maxLength()}</span>
        </div>
      </Show>
      <textarea
        class="studio-template-creator-textarea"
        value={props.value}
        rows={props.rows ?? 4}
        maxLength={maxLength()}
        placeholder={props.placeholder}
        onInput={(event) => props.onInput(truncateValue(event.currentTarget.value, maxLength()))}
      />
    </div>
  )
}

function TemplateImageUploader(props: {
  title: string
  required?: boolean
  description: string
  value: TemplateUploadImage[]
  maxCount: number
  minCount?: number
  maxFileSizeMb: number
  maxTotalSizeMb?: number
  sizeByUrl: Record<string, number>
  message: string
  onChange: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onMessage: (message: string) => void
}): JSX.Element {
  let inputRef!: HTMLInputElement
  const canAddImage = () => props.value.length < props.maxCount
  const triggerPicker = () => inputRef?.click()

  const removeImage = (index: number) => {
    props.onChange(props.value.filter((_, currentIndex) => currentIndex !== index))
    props.onMessage("")
  }

  const handleFiles = (files: File[]) => {
    const result = files.reduce(
      (acc, file) => {
        const skipped = (reason: string) => ({
          ...acc,
          skippedCount: acc.skippedCount + 1,
          firstReason: acc.firstReason || reason,
        })
        if (!acceptedImageFile(file)) return skipped("格式仅支持 png、jpg、jpeg、webp")
        if (file.size > maxBytes(props.maxFileSizeMb)) return skipped(`单张图片不能超过 ${props.maxFileSizeMb}MB`)
        if (acc.count >= props.maxCount) return skipped(`最多上传 ${props.maxCount} 张图片`)
        if (props.maxTotalSizeMb && acc.totalSize + file.size > maxBytes(props.maxTotalSizeMb)) return skipped(`图片总大小不能超过 ${props.maxTotalSizeMb}MB`)
        return {
          ...acc,
          acceptedFiles: [...acc.acceptedFiles, file],
          count: acc.count + 1,
          totalSize: acc.totalSize + file.size,
        }
      },
      {
        acceptedFiles: [] as File[],
        count: props.value.length,
        firstReason: "",
        skippedCount: 0,
        totalSize: props.maxTotalSizeMb ? imageTotalSize(props.value, props.sizeByUrl) : 0,
      },
    )

    void Promise.all(
      result.acceptedFiles.map((file) =>
        fileToDataUrl(file).then(
          (url) => ({ url, file }),
          () => null,
        ),
      ),
    ).then((records) => {
      const validRecords = records.filter(isTemplateUploadRecord)
      const readFailedCount = records.length - validRecords.length
      props.onChange([...props.value, ...validRecords.map((record) => ({ url: record.url }))])
      props.onSizes(validRecords.reduce((sizes, record) => ({ ...sizes, [record.url]: record.file.size }), {}))
      props.onMessage(
        result.skippedCount || readFailedCount
          ? `已跳过 ${result.skippedCount + readFailedCount} 张图片${result.firstReason ? `：${result.firstReason}` : ""}`
          : "",
      )
    })
  }

  return (
    <TemplateCreatorField title={props.title} required={props.required} description={props.description}>
      <input
        ref={inputRef!}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        class="studio-template-creator-upload-input"
        onChange={(event) => {
          handleFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ""
        }}
      />
      <Show
        when={props.value.length > 0}
        fallback={
          <div class="studio-template-creator-upload-empty">
            <button type="button" class="studio-template-creator-upload-button" onClick={triggerPicker}>
              本地上传
            </button>
            <div class="studio-template-creator-upload-format">支持图片格式： png ｜ jpg ｜ jpeg ｜ webp</div>
          </div>
        }
      >
        <div class="studio-template-creator-upload-grid">
          <Show when={canAddImage()}>
            <button type="button" class="studio-template-creator-upload-more" onClick={triggerPicker}>
              <span class="studio-template-creator-upload-plus" aria-hidden="true" />
              <span>继续上传</span>
            </button>
          </Show>
          <For each={props.value}>
            {(image, index) => (
              <div class="studio-template-creator-upload-thumb">
                <img src={image.url} alt="" class="studio-template-creator-upload-thumb-image" />
                <button
                  type="button"
                  class="studio-template-creator-upload-remove"
                  aria-label="删除图片"
                  title="删除图片"
                  onClick={() => removeImage(index())}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.message}>
        <div class="studio-template-creator-upload-message">{props.message}</div>
      </Show>
    </TemplateCreatorField>
  )
}

function StyleDescriptionSection(props: {
  overview: string
  details: Partial<Record<StudioStyleDimensionId, string>>
  selectedDimensions: StudioStyleDimensionId[]
  totalCount: number
  canGenerateStyleDescription: boolean
  styleDescriptionGenerating: boolean
  styleDescriptionGenerateTip: string
  styleDescriptionGenerateError: boolean
  styleDescriptionThinking: string
  showStyleDescriptionThinking: boolean
  onOverview: (value: string) => void
  onDetail: (id: StudioStyleDimensionId, value: string) => void
  onToggleDimension: (id: StudioStyleDimensionId) => void
  onGenerateStyleDescription: () => void
}): JSX.Element {
  const selectedDimensionItems = createMemo(() => STYLE_DIMENSIONS.filter((dimension) => props.selectedDimensions.includes(dimension.id)))
  let thinkingRef: HTMLDivElement | undefined

  createEffect(() => {
    props.styleDescriptionThinking
    queueMicrotask(() => {
      if (!thinkingRef) return
      thinkingRef.scrollTop = thinkingRef.scrollHeight
    })
  })

  return (
    <TemplateCreatorField
      title="风格描述"
      required
      description="可从多种风格维度中选择你希望保留的维度（仅分析选中的风格维度）"
    >
      <div class="studio-template-creator-chip-list">
        <For each={STYLE_DIMENSIONS}>
          {(dimension) => (
            <button
              type="button"
              class="studio-template-creator-chip"
              classList={{ active: props.selectedDimensions.includes(dimension.id) }}
              onClick={() => props.onToggleDimension(dimension.id)}
            >
              {dimension.label}
            </button>
          )}
        </For>
      </div>
      <div class="studio-template-creator-generate-wrap">
        <button
          type="button"
          class="studio-template-creator-generate-button"
          disabled={!props.canGenerateStyleDescription || props.styleDescriptionGenerating}
          onClick={props.onGenerateStyleDescription}
        >
          <span aria-hidden="true">✦</span>
          <span>{props.styleDescriptionGenerating ? "生成中..." : "生成风格描述"}</span>
        </button>
        <div class="studio-template-creator-generate-tip" classList={{ error: props.styleDescriptionGenerateError }}>
          {props.styleDescriptionGenerateTip}
        </div>
        <Show when={props.showStyleDescriptionThinking}>
          <div
            ref={(element) => {
              thinkingRef = element
            }}
            class="studio-template-creator-thinking"
          >
            {props.styleDescriptionThinking}
          </div>
        </Show>
      </div>
      <div class="studio-template-creator-description-panel">
        <TemplateCreatorTextarea
          label="概览："
          value={props.overview}
          placeholder="描述图片的整体风格定性、风格流派标签、核心视觉特征"
          onInput={props.onOverview}
        />
        <For each={selectedDimensionItems()}>
          {(dimension) => (
            <TemplateCreatorTextarea
              label={`${dimension.label}：`}
              value={props.details[dimension.id] ?? ""}
              placeholder={dimension.placeholder}
              onInput={(value) => props.onDetail(dimension.id, value)}
            />
          )}
        </For>
        <div class="studio-template-creator-description-total" classList={{ over: props.totalCount > DESCRIPTION_TOTAL_MAX_LENGTH }}>
          总字符数：{props.totalCount}/{DESCRIPTION_TOTAL_MAX_LENGTH}
        </div>
      </div>
    </TemplateCreatorField>
  )
}

function VisualStyleForm(props: {
  styleKeywords: string
  styleImages: TemplateUploadImage[]
  sizeByUrl: Record<string, number>
  uploadMessage: string
  selectedDimensions: StudioStyleDimensionId[]
  styleDescriptionOverview: string
  styleDescriptionDetails: Partial<Record<StudioStyleDimensionId, string>>
  styleDescriptionTotalCount: number
  canGenerateStyleDescription: boolean
  styleDescriptionGenerating: boolean
  styleDescriptionGenerateTip: string
  styleDescriptionGenerateError: boolean
  styleDescriptionThinking: string
  showStyleDescriptionThinking: boolean
  onStyleKeywords: (value: string) => void
  onStyleImages: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onUploadMessage: (message: string) => void
  onToggleDimension: (id: StudioStyleDimensionId) => void
  onStyleDescriptionOverview: (value: string) => void
  onStyleDescriptionDetail: (id: StudioStyleDimensionId, value: string) => void
  onGenerateStyleDescription: () => void
}): JSX.Element {
  return (
    <>
      <TemplateCreatorField title="风格关键词">
        <textarea
          class="studio-template-creator-textarea standalone"
          rows={4}
          value={props.styleKeywords}
          placeholder="输入你希望强调的风格特征，可以使用短词和句子，例：抽象风格壁纸、弥散渐变风格"
          onInput={(event) => props.onStyleKeywords(event.currentTarget.value)}
        />
      </TemplateCreatorField>
      <TemplateImageUploader
        title="风格图集"
        required
        description="上传风格一致的参考图，最多30张，最少3张，大小在10M以下，尽量高清"
        value={props.styleImages}
        maxCount={30}
        minCount={3}
        maxFileSizeMb={10}
        maxTotalSizeMb={30}
        sizeByUrl={props.sizeByUrl}
        message={props.uploadMessage}
        onChange={props.onStyleImages}
        onSizes={props.onSizes}
        onMessage={props.onUploadMessage}
      />
      <StyleDescriptionSection
        overview={props.styleDescriptionOverview}
        details={props.styleDescriptionDetails}
        selectedDimensions={props.selectedDimensions}
        totalCount={props.styleDescriptionTotalCount}
        canGenerateStyleDescription={props.canGenerateStyleDescription}
        styleDescriptionGenerating={props.styleDescriptionGenerating}
        styleDescriptionGenerateTip={props.styleDescriptionGenerateTip}
        styleDescriptionGenerateError={props.styleDescriptionGenerateError}
        styleDescriptionThinking={props.styleDescriptionThinking}
        showStyleDescriptionThinking={props.showStyleDescriptionThinking}
        onOverview={props.onStyleDescriptionOverview}
        onDetail={props.onStyleDescriptionDetail}
        onToggleDimension={props.onToggleDimension}
        onGenerateStyleDescription={props.onGenerateStyleDescription}
      />
    </>
  )
}

function InspirationRecipeForm(props: {
  recipeDescription: string
  recipeImages: TemplateUploadImage[]
  sizeByUrl: Record<string, number>
  uploadMessage: string
  onRecipeDescription: (value: string) => void
  onRecipeImages: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onUploadMessage: (message: string) => void
}): JSX.Element {
  return (
    <>
      <TemplateCreatorField title="玩法描述" required>
        <div class="studio-template-creator-field-description multi-line">
          <div>如允许其他用户自行填写内容，使用“【内容填写提示】”来标记，否则发布后不支持其他用户输入。</div>
          <div>例：淡金色的粒子环绕着【填写主体内容】悬浮在画面中心，背景是纯白色...</div>
        </div>
        <textarea
          class="studio-template-creator-textarea standalone large"
          rows={8}
          value={props.recipeDescription}
          placeholder={DEFAULT_RECIPE_PLACEHOLDER}
          onInput={(event) => props.onRecipeDescription(event.currentTarget.value)}
        />
      </TemplateCreatorField>
      <TemplateImageUploader
        title="固定参考图"
        description="可选上传，上传后将作为默认参考图，最多支持3张参考图，每张参考图不超过10MB"
        value={props.recipeImages}
        maxCount={3}
        minCount={0}
        maxFileSizeMb={10}
        sizeByUrl={props.sizeByUrl}
        message={props.uploadMessage}
        onChange={props.onRecipeImages}
        onSizes={props.onSizes}
        onMessage={props.onUploadMessage}
      />
    </>
  )
}

function MakeTemplateForm(props: {
  title: string
  category: TemplateCreatorCategory
  styleKeywords: string
  styleImages: TemplateUploadImage[]
  recipeDescription: string
  recipeImages: TemplateUploadImage[]
  sizeByUrl: Record<string, number>
  styleUploadMessage: string
  recipeUploadMessage: string
  selectedDimensions: StudioStyleDimensionId[]
  styleDescriptionOverview: string
  styleDescriptionDetails: Partial<Record<StudioStyleDimensionId, string>>
  styleDescriptionTotalCount: number
  canGenerateStyleDescription: boolean
  styleDescriptionGenerating: boolean
  styleDescriptionGenerateTip: string
  styleDescriptionGenerateError: boolean
  styleDescriptionThinking: string
  showStyleDescriptionThinking: boolean
  onTitle: (value: string) => void
  onCategory: (value: TemplateCreatorCategory) => void
  onStyleKeywords: (value: string) => void
  onStyleImages: (images: TemplateUploadImage[]) => void
  onRecipeDescription: (value: string) => void
  onRecipeImages: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onStyleUploadMessage: (message: string) => void
  onRecipeUploadMessage: (message: string) => void
  onToggleDimension: (id: StudioStyleDimensionId) => void
  onStyleDescriptionOverview: (value: string) => void
  onStyleDescriptionDetail: (id: StudioStyleDimensionId, value: string) => void
  onGenerateStyleDescription: () => void
}): JSX.Element {
  return (
    <>
      <TemplateCreatorField title="图片模板标题" required>
        <TemplateCreatorTitleInput value={props.title} onInput={props.onTitle} />
      </TemplateCreatorField>
      <TemplateCreatorField title="模型分类" required>
        <TemplateCreatorCategoryCards value={props.category} onChange={props.onCategory} />
      </TemplateCreatorField>
      <Show
        when={props.category === "extract_style"}
        fallback={
          <InspirationRecipeForm
            recipeDescription={props.recipeDescription}
            recipeImages={props.recipeImages}
            sizeByUrl={props.sizeByUrl}
            uploadMessage={props.recipeUploadMessage}
            onRecipeDescription={props.onRecipeDescription}
            onRecipeImages={props.onRecipeImages}
            onSizes={props.onSizes}
            onUploadMessage={props.onRecipeUploadMessage}
          />
        }
      >
        <VisualStyleForm
          styleKeywords={props.styleKeywords}
          styleImages={props.styleImages}
          sizeByUrl={props.sizeByUrl}
          uploadMessage={props.styleUploadMessage}
          selectedDimensions={props.selectedDimensions}
          styleDescriptionOverview={props.styleDescriptionOverview}
          styleDescriptionDetails={props.styleDescriptionDetails}
          styleDescriptionTotalCount={props.styleDescriptionTotalCount}
          canGenerateStyleDescription={props.canGenerateStyleDescription}
          styleDescriptionGenerating={props.styleDescriptionGenerating}
          styleDescriptionGenerateTip={props.styleDescriptionGenerateTip}
          styleDescriptionGenerateError={props.styleDescriptionGenerateError}
          styleDescriptionThinking={props.styleDescriptionThinking}
          showStyleDescriptionThinking={props.showStyleDescriptionThinking}
          onStyleKeywords={props.onStyleKeywords}
          onStyleImages={props.onStyleImages}
          onSizes={props.onSizes}
          onUploadMessage={props.onStyleUploadMessage}
          onToggleDimension={props.onToggleDimension}
          onStyleDescriptionOverview={props.onStyleDescriptionOverview}
          onStyleDescriptionDetail={props.onStyleDescriptionDetail}
          onGenerateStyleDescription={props.onGenerateStyleDescription}
        />
      </Show>
    </>
  )
}

function referenceCountValue(value: ReferenceCount) {
  return String(value) as `${ReferenceCount}`
}

function referenceCountFromValue(value: `${ReferenceCount}`): ReferenceCount {
  return Number(value) as ReferenceCount
}

function ReferenceSettingFields(props: {
  referenceMode: ReferenceMode
  referenceCount: ReferenceCount
  onReferenceMode: (value: ReferenceMode) => void
  onReferenceCount: (value: ReferenceCount) => void
}): JSX.Element {
  const countLabel = createMemo(() => (props.referenceMode === "fixed" ? "固定张数" : "最多上传数"))

  return (
    <TemplateCreatorField title="参考图设置" required>
      <div class="studio-template-creator-reference-row">
        <div class="studio-template-creator-setting-column">
          <div class="studio-template-creator-setting-label">参考模式</div>
          <TemplateCreatorSelect
            value={props.referenceMode}
            options={REFERENCE_MODE_OPTIONS}
            onChange={props.onReferenceMode}
            ariaLabel="参考模式"
          />
        </div>
        <Show when={props.referenceMode !== "not_supported"}>
          <div class="studio-template-creator-setting-column">
            <div class="studio-template-creator-setting-label">{countLabel()}</div>
            <TemplateCreatorSelect
              value={referenceCountValue(props.referenceCount)}
              options={REFERENCE_COUNT_OPTIONS}
              onChange={(value) => props.onReferenceCount(referenceCountFromValue(value))}
              ariaLabel={countLabel()}
              suffix="张"
            />
          </div>
        </Show>
      </div>
    </TemplateCreatorField>
  )
}

function VisibilitySettingFields(props: {
  visibility: TemplateVisibility
  specifiedUsers: string
  onVisibility: (value: TemplateVisibility) => void
  onSpecifiedUsers: (value: string) => void
}): JSX.Element {
  return (
    <TemplateCreatorField title="权限设置" required>
      <div class="studio-template-creator-setting-label">可见范围</div>
      <div class="studio-template-creator-radio-list">
        <button
          type="button"
          class="studio-template-creator-radio"
          classList={{ active: props.visibility === "all_users" }}
          aria-pressed={props.visibility === "all_users"}
          onClick={() => props.onVisibility("all_users")}
        >
          <span class="studio-template-creator-radio-dot" aria-hidden="true" />
          <span>所有用户</span>
        </button>
        <button
          type="button"
          class="studio-template-creator-radio"
          classList={{ active: props.visibility === "specified_users" }}
          aria-pressed={props.visibility === "specified_users"}
          onClick={() => props.onVisibility("specified_users")}
        >
          <span class="studio-template-creator-radio-dot" aria-hidden="true" />
          <span>仅指定用户</span>
        </button>
      </div>
      <Show when={props.visibility === "specified_users"}>
        <div class="studio-template-creator-user-field">
          <div class="studio-template-creator-setting-label">指定可见用户</div>
          <input
            class="studio-template-creator-user-input"
            value={props.specifiedUsers}
            placeholder="请输入8位工号或姓名全拼，以“，”号间隔"
            onInput={(event) => props.onSpecifiedUsers(event.currentTarget.value)}
          />
        </div>
      </Show>
    </TemplateCreatorField>
  )
}

function PublishTemplateForm(props: {
  title: string
  usageDescription: string
  promptSetting: PromptSetting
  referenceMode: ReferenceMode
  referenceCount: ReferenceCount
  visibility: TemplateVisibility
  specifiedUsers: string
  onTitle: (value: string) => void
  onUsageDescription: (value: string) => void
  onPromptSetting: (value: PromptSetting) => void
  onReferenceMode: (value: ReferenceMode) => void
  onReferenceCount: (value: ReferenceCount) => void
  onVisibility: (value: TemplateVisibility) => void
  onSpecifiedUsers: (value: string) => void
}): JSX.Element {
  return (
    <>
      <TemplateCreatorField title="确认图片模板标题" required>
        <TemplateCreatorTitleInput value={props.title} onInput={props.onTitle} />
      </TemplateCreatorField>
      <TemplateCreatorField title="模板使用说明" required>
        <textarea
          class="studio-template-creator-textarea standalone usage"
          rows={6}
          value={props.usageDescription}
          placeholder="向其他用户介绍如何使用此模板"
          onInput={(event) => props.onUsageDescription(event.currentTarget.value)}
        />
      </TemplateCreatorField>
      <TemplateCreatorField title="提示词设置" required>
        <TemplateCreatorSelect
          value={props.promptSetting}
          options={PROMPT_SETTING_OPTIONS}
          onChange={props.onPromptSetting}
          ariaLabel="提示词设置"
        />
      </TemplateCreatorField>
      <ReferenceSettingFields
        referenceMode={props.referenceMode}
        referenceCount={props.referenceCount}
        onReferenceMode={props.onReferenceMode}
        onReferenceCount={props.onReferenceCount}
      />
      <VisibilitySettingFields
        visibility={props.visibility}
        specifiedUsers={props.specifiedUsers}
        onVisibility={props.onVisibility}
        onSpecifiedUsers={props.onSpecifiedUsers}
      />
    </>
  )
}

function TemplateCreatorExamplesForm(props: {
  category: TemplateCreatorCategory
  exampleImages: TemplateUploadImage[]
  sizeByUrl: Record<string, number>
  uploadMessage: string
  onExampleImages: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onUploadMessage: (message: string) => void
}): JSX.Element {
  const description = createMemo(() =>
    props.category === "extract_style"
      ? "风格模板至少要添加1张例图，让使用者了解风格特征，单张不超过10M，最多20张"
      : "预设灵感配方至少要上传1张例图，让使用者了解玩法结果的变化，单张不超过10M，最多20张",
  )

  return (
    <TemplateImageUploader
      title="添加示例图"
      required
      description={description()}
      value={props.exampleImages}
      maxCount={20}
      minCount={1}
      maxFileSizeMb={10}
      maxTotalSizeMb={30}
      sizeByUrl={props.sizeByUrl}
      message={props.uploadMessage}
      onChange={props.onExampleImages}
      onSizes={props.onSizes}
      onMessage={props.onUploadMessage}
    />
  )
}

function TemplateCreatorFooter(props: {
  currentStep: TemplateCreatorStep
  canNext: boolean
  primaryLabel: string
  message: string
  messageTone: "default" | "success" | "error"
  onPrev: () => void
  onNext: () => void
}): JSX.Element {
  return (
    <div class="studio-template-creator-footer">
      <div class="studio-template-creator-footer-actions">
        <Show when={props.currentStep !== "make"}>
          <button type="button" class="studio-template-creator-prev" onClick={props.onPrev}>
            上一步
          </button>
        </Show>
        <button type="button" class="studio-template-creator-next" disabled={!props.canNext} onClick={props.onNext}>
          {props.primaryLabel}
        </button>
      </div>
      <Show when={props.message}>
        <div class="studio-template-creator-footer-message" classList={{ success: props.messageTone === "success", error: props.messageTone === "error" }}>
          {props.message}
        </div>
      </Show>
    </div>
  )
}

export function StudioTemplateCreator(props: {
  onGenerateStyleDescription?: (
    input: StudioStyleDescriptionGenerateInput,
    handlers: StudioStyleDescriptionGenerateHandlers,
  ) => Promise<void>
  onPublishTemplate?: (input: StudioTemplatePublishInput) => Promise<void>
}): JSX.Element {
  const [currentStep, setCurrentStep] = createSignal<TemplateCreatorStep>("make")
  const [title, setTitle] = createSignal("")
  const [category, setCategory] = createSignal<TemplateCreatorCategory>("extract_style")
  const [styleKeywords, setStyleKeywords] = createSignal("")
  const [styleImages, setStyleImages] = createSignal<TemplateUploadImage[]>([])
  const [selectedDimensions, setSelectedDimensions] = createSignal<StudioStyleDimensionId[]>([...DEFAULT_STYLE_DIMENSIONS])
  const [styleDescriptionOverview, setStyleDescriptionOverview] = createSignal("")
  const [styleDescriptionDetails, setStyleDescriptionDetails] = createSignal<Partial<Record<StudioStyleDimensionId, string>>>({})
  const [styleDescriptionGenerating, setStyleDescriptionGenerating] = createSignal(false)
  const [styleDescriptionGenerateMessage, setStyleDescriptionGenerateMessage] = createSignal("")
  const [styleDescriptionStreamPhase, setStyleDescriptionStreamPhase] = createSignal<StyleDescriptionStreamPhase>("idle")
  const [styleDescriptionThinking, setStyleDescriptionThinking] = createSignal("")
  const [styleDescriptionStreamStarted, setStyleDescriptionStreamStarted] = createSignal(false)
  const [templatePublishing, setTemplatePublishing] = createSignal(false)
  const [templatePublishMessage, setTemplatePublishMessage] = createSignal("")
  const [templatePublishMessageTone, setTemplatePublishMessageTone] = createSignal<"default" | "success" | "error">("default")
  const [recipeDescription, setRecipeDescription] = createSignal("")
  const [recipeImages, setRecipeImages] = createSignal<TemplateUploadImage[]>([])
  const [sizeByUrl, setSizeByUrl] = createSignal<Record<string, number>>({})
  const [styleUploadMessage, setStyleUploadMessage] = createSignal("")
  const [recipeUploadMessage, setRecipeUploadMessage] = createSignal("")
  const [usageDescription, setUsageDescription] = createSignal("")
  const [promptSetting, setPromptSetting] = createSignal<PromptSetting>("required")
  const [referenceMode, setReferenceMode] = createSignal<ReferenceMode>("fixed")
  const [referenceCount, setReferenceCount] = createSignal<ReferenceCount>(1)
  const [visibility, setVisibility] = createSignal<TemplateVisibility>("all_users")
  const [specifiedUsers, setSpecifiedUsers] = createSignal("")
  const [exampleImages, setExampleImages] = createSignal<TemplateUploadImage[]>([])
  const [exampleUploadMessage, setExampleUploadMessage] = createSignal("")
  const styleDescriptionTotalCount = createMemo(() =>
    styleDescriptionOverview().length + Object.values(styleDescriptionDetails()).reduce((sum, value) => sum + (value?.length ?? 0), 0),
  )
  const canGenerateStyleDescription = createMemo(() => styleImages().length >= 3 && Boolean(props.onGenerateStyleDescription))
  const showStyleDescriptionThinking = createMemo(() => styleDescriptionStreamPhase() === "extracting" && styleDescriptionThinking().length > 0)
  const styleDescriptionGenerateTip = createMemo(() => {
    if (styleDescriptionGenerateMessage()) return styleDescriptionGenerateMessage()
    if (styleDescriptionStreamPhase() === "extracting") return "正在提取图片风格特征"
    if (styleDescriptionStreamPhase() === "summarizing") return "正在汇总风格描述"
    if (styleDescriptionStreamPhase() === "done") return "风格描述已生成。"
    return "生成风格描述需要先上传风格图集，生成描述耗时约20-30s，请耐心等待。"
  })
  const titleValid = createMemo(() => title().trim().length >= TITLE_MIN_LENGTH && title().trim().length <= TITLE_MAX_LENGTH)
  const canMakeNext = createMemo(() => {
    if (!titleValid()) return false
    if (category() === "preset_recipe") return recipeDescription().trim().length > 0 && recipeImages().length <= 3
    return (
      styleImages().length >= 3 &&
      styleImages().length <= 30 &&
      imageTotalSize(styleImages(), sizeByUrl()) <= 30 * BYTES_IN_MB &&
      styleDescriptionOverview().trim().length > 0 &&
      styleDescriptionTotalCount() <= DESCRIPTION_TOTAL_MAX_LENGTH
    )
  })
  const canPublishNext = createMemo(() =>
    titleValid() &&
    usageDescription().trim().length > 0 &&
    Boolean(promptSetting()) &&
    Boolean(referenceMode()) &&
    (referenceMode() === "not_supported" || [1, 2, 3].includes(referenceCount())) &&
    Boolean(visibility()) &&
    (visibility() === "all_users" || specifiedUsers().trim().length > 0),
  )
  const canPublish = createMemo(
    () =>
      exampleImages().length >= 1 &&
      exampleImages().length <= 20 &&
      imageTotalSize(exampleImages(), sizeByUrl()) <= 30 * BYTES_IN_MB,
  )
  const canNext = createMemo(() => {
    if (currentStep() === "make") return canMakeNext()
    if (currentStep() === "publish") return canPublishNext()
    return canMakeNext() && canPublishNext() && canPublish() && Boolean(props.onPublishTemplate) && !templatePublishing()
  })
  const primaryLabel = createMemo(() => (currentStep() === "examples" && templatePublishing() ? "发布中..." : currentStep() === "examples" ? "发布" : "下一步"))
  let styleDescriptionGenerateController: AbortController | undefined

  onCleanup(() => {
    styleDescriptionGenerateController?.abort()
  })

  const mergeSizes = (sizes: Record<string, number>) => {
    setSizeByUrl((current) => ({ ...current, ...sizes }))
  }
  const toggleDimension = (id: StudioStyleDimensionId) => {
    setSelectedDimensions((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }
  const updateStyleDescriptionDetail = (id: StudioStyleDimensionId, value: string) => {
    setStyleDescriptionDetails((current) => ({ ...current, [id]: value }))
  }
  const styleDescriptionPayload = (): StudioTemplateStyleDescription => ({
    overview: styleDescriptionOverview().trim(),
    ...Object.fromEntries(
      selectedDimensions().map((id) => [
        id,
        (styleDescriptionDetails()[id] ?? "").trim(),
      ]),
    ),
  })
  const templatePublishBaseInput = (): StudioTemplatePublishBaseInput => ({
    allowed_user_id: visibility() === "specified_users" ? specifiedUsers().trim() : null,
    example_images: exampleImages(),
    permission_type: visibility(),
    prompt_setting: promptSetting(),
    reference_image_count: referenceMode() === "not_supported" ? 0 : referenceCount(),
    reference_image_setting: referenceMode(),
    template_type: category(),
    title: title().trim(),
    usage_instructions: usageDescription().trim(),
  })
  const templatePublishInput = (): StudioTemplatePublishInput =>
    category() === "extract_style"
      ? {
        ...templatePublishBaseInput(),
        template_type: "extract_style",
        style_description: styleDescriptionPayload(),
        style_images: styleImages(),
        style_keywords: styleKeywords(),
      }
      : {
        ...templatePublishBaseInput(),
        template_type: "preset_recipe",
        fixed_reference_images: recipeImages(),
        play_description: recipeDescription().trim(),
      }
  const startStyleDescriptionStream = () => {
    if (styleDescriptionStreamStarted()) {
      setStyleDescriptionStreamPhase("extracting")
      return
    }
    setStyleDescriptionStreamStarted(true)
    setStyleDescriptionOverview("")
    setStyleDescriptionDetails({})
    setStyleDescriptionThinking("")
    setStyleDescriptionStreamPhase("extracting")
  }
  const appendStyleDescriptionField = (field: StyleDescriptionStreamField, content: string) => {
    if (!content) return
    setStyleDescriptionStreamPhase("summarizing")
    if (field === "overview") {
      setStyleDescriptionOverview((current) => truncateValue(current + content, DESCRIPTION_ITEM_MAX_LENGTH))
      return
    }
    setStyleDescriptionDetails((current) => ({
      ...current,
      [field]: truncateValue((current[field] ?? "") + content, DESCRIPTION_ITEM_MAX_LENGTH),
    }))
  }
  const handleStyleDescriptionStreamEvent = (event: StudioStyleDescriptionStreamEvent) => {
    if (event.type === "error") {
      setStyleDescriptionStreamPhase("error")
      setStyleDescriptionGenerateMessage(event.content?.trim() || "风格描述生成失败")
      setStyleDescriptionGenerating(false)
      styleDescriptionGenerateController?.abort()
      return
    }
    if (event.type === "step") {
      startStyleDescriptionStream()
      return
    }
    if (event.type === "think") {
      setStyleDescriptionStreamPhase("extracting")
      setStyleDescriptionThinking((current) => current + (event.content ?? ""))
      return
    }
    if (!isStyleDescriptionStreamField(event.type)) return
    appendStyleDescriptionField(event.type, event.content ?? "")
  }
  const generateStyleDescription = async () => {
    if (!props.onGenerateStyleDescription || !canGenerateStyleDescription() || styleDescriptionGenerating()) return
    styleDescriptionGenerateController?.abort()
    const controller = new AbortController()
    styleDescriptionGenerateController = controller
    setStyleDescriptionGenerating(true)
    setStyleDescriptionGenerateMessage("")
    setStyleDescriptionStreamStarted(false)
    try {
      await props.onGenerateStyleDescription(
        {
          style_keywords: styleKeywords(),
          style_images: styleImages(),
          style_dimensions: selectedDimensions(),
        },
        {
          signal: controller.signal,
          onEvent: handleStyleDescriptionStreamEvent,
        },
      )
      if (!controller.signal.aborted) {
        setStyleDescriptionStreamPhase("done")
        setStyleDescriptionThinking("")
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStyleDescriptionStreamPhase("error")
        setStyleDescriptionGenerateMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (styleDescriptionGenerateController === controller) styleDescriptionGenerateController = undefined
      if (!controller.signal.aborted) setStyleDescriptionGenerating(false)
    }
  }
  const publishCurrentTemplate = async () => {
    if (!props.onPublishTemplate || templatePublishing() || !canMakeNext() || !canPublishNext() || !canPublish()) return
    setTemplatePublishing(true)
    setTemplatePublishMessage("")
    setTemplatePublishMessageTone("default")
    try {
      await props.onPublishTemplate(templatePublishInput())
      setTemplatePublishMessage("模板发布成功")
      setTemplatePublishMessageTone("success")
    } catch (error) {
      setTemplatePublishMessage(error instanceof Error ? error.message : String(error))
      setTemplatePublishMessageTone("error")
    } finally {
      setTemplatePublishing(false)
    }
  }
  const goPrev = () => {
    setCurrentStep((step) => {
      if (step === "examples") return "publish"
      if (step === "publish") return "make"
      return step
    })
  }
  const goNext = () => {
    if (!canNext()) return
    if (currentStep() === "examples") {
      void publishCurrentTemplate()
      return
    }
    setCurrentStep((step) => {
      if (step === "make") return "publish"
      if (step === "publish") return "examples"
      return step
    })
  }

  return (
    <div class="studio-template-creator">
      <div class="studio-template-creator-scroll">
        <div class="studio-template-creator-form">
          <Show
            when={currentStep() === "make"}
            fallback={
              <Show
                when={currentStep() === "publish"}
                fallback={
                  <>
                    <TemplateCreatorSteps currentStep={currentStep()} />
                    <TemplateCreatorExamplesForm
                      category={category()}
                      exampleImages={exampleImages()}
                      sizeByUrl={sizeByUrl()}
                      uploadMessage={exampleUploadMessage()}
                      onExampleImages={setExampleImages}
                      onSizes={mergeSizes}
                      onUploadMessage={setExampleUploadMessage}
                    />
                  </>
                }
              >
                <TemplateCreatorSteps currentStep={currentStep()} />
                <PublishTemplateForm
                  title={title()}
                  usageDescription={usageDescription()}
                  promptSetting={promptSetting()}
                  referenceMode={referenceMode()}
                  referenceCount={referenceCount()}
                  visibility={visibility()}
                  specifiedUsers={specifiedUsers()}
                  onTitle={setTitle}
                  onUsageDescription={setUsageDescription}
                  onPromptSetting={setPromptSetting}
                  onReferenceMode={setReferenceMode}
                  onReferenceCount={setReferenceCount}
                  onVisibility={setVisibility}
                  onSpecifiedUsers={setSpecifiedUsers}
                />
              </Show>
            }
          >
            <TemplateCreatorSteps currentStep={currentStep()} />
            <MakeTemplateForm
              title={title()}
              category={category()}
              styleKeywords={styleKeywords()}
              styleImages={styleImages()}
              recipeDescription={recipeDescription()}
              recipeImages={recipeImages()}
              sizeByUrl={sizeByUrl()}
              styleUploadMessage={styleUploadMessage()}
              recipeUploadMessage={recipeUploadMessage()}
              selectedDimensions={selectedDimensions()}
              styleDescriptionOverview={styleDescriptionOverview()}
              styleDescriptionDetails={styleDescriptionDetails()}
              styleDescriptionTotalCount={styleDescriptionTotalCount()}
              canGenerateStyleDescription={canGenerateStyleDescription()}
              styleDescriptionGenerating={styleDescriptionGenerating()}
              styleDescriptionGenerateTip={styleDescriptionGenerateTip()}
              styleDescriptionGenerateError={styleDescriptionStreamPhase() === "error"}
              styleDescriptionThinking={styleDescriptionThinking()}
              showStyleDescriptionThinking={showStyleDescriptionThinking()}
              onTitle={setTitle}
              onCategory={setCategory}
              onStyleKeywords={setStyleKeywords}
              onStyleImages={setStyleImages}
              onRecipeDescription={setRecipeDescription}
              onRecipeImages={setRecipeImages}
              onSizes={mergeSizes}
              onStyleUploadMessage={setStyleUploadMessage}
              onRecipeUploadMessage={setRecipeUploadMessage}
              onToggleDimension={toggleDimension}
              onStyleDescriptionOverview={setStyleDescriptionOverview}
              onStyleDescriptionDetail={updateStyleDescriptionDetail}
              onGenerateStyleDescription={() => void generateStyleDescription()}
            />
          </Show>
        </div>
      </div>
      <TemplateCreatorFooter
        currentStep={currentStep()}
        canNext={canNext()}
        primaryLabel={primaryLabel()}
        message={templatePublishMessage()}
        messageTone={templatePublishMessageTone()}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  )
}
