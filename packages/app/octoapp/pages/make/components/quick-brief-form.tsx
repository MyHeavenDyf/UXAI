import { createSignal, Show, For } from 'solid-js'
import type { QuestionForm, FormQuestion, FormOption } from '../utils/question-form'
import { formatFormAnswers } from '../utils/question-form'
import './quick-brief-form.css'

interface Props {
  form: QuestionForm
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void
  interactive?: boolean
  submitted?: boolean
}

export function QuickBriefFormView(props: Props) {
  const [answers, setAnswers] = createSignal<Record<string, string | string[]>>(buildInitialState(props.form))
  const [customInputs, setCustomInputs] = createSignal<Record<string, string>>({})
  const [locallySubmitted, setLocallySubmitted] = createSignal(false)

  const isLocked = () => props.submitted || locallySubmitted() || props.interactive === false || !props.onSubmit
  const currentAnswers = () => answers()

  function buildInitialState(form: QuestionForm): Record<string, string | string[]> {
    const initial: Record<string, string | string[]> = {}
    for (const q of form.questions) {
      if (q.defaultValue !== undefined) {
        initial[q.id] = q.defaultValue
      }
    }
    return initial
  }

  const updateAnswer = (id: string, value: string | string[]) => {
    if (isLocked()) return
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  const toggleCheckbox = (id: string, optionValue: string, maxSelections?: number) => {
    if (isLocked()) return
    setAnswers(prev => {
      const current = Array.isArray(prev[id]) ? prev[id] as string[] : []
      const has = current.includes(optionValue)
      if (!has && maxSelections !== undefined && current.length >= maxSelections) {
        return prev
      }
      const next = has ? current.filter(v => v !== optionValue) : [...current, optionValue]
      return { ...prev, [id]: next }
    })
  }

  /** 自定义输入:radio 模式与选项互斥(输入即覆盖);checkbox 模式与选项并存(提交时追加) */
  const updateCustom = (id: string, value: string, type: FormQuestion['type']) => {
    if (isLocked()) return
    setCustomInputs(prev => ({ ...prev, [id]: value }))
    if (type === 'radio' && value.trim() !== '') {
      setAnswers(prev => ({ ...prev, [id]: '' }))
    }
  }

  const isQuestionAnswered = (q: FormQuestion) => {
    const v = currentAnswers()[q.id]
    const hasPreset = Array.isArray(v) ? v.length > 0 : (typeof v === 'string' && v.trim().length > 0)
    if (hasPreset) return true
    if (q.allowCustom) {
      const custom = customInputs()[q.id]?.trim()
      return !!custom
    }
    return false
  }

  const missingRequired = () => {
    for (const q of props.form.questions) {
      if (!q.required) continue
      if (!isQuestionAnswered(q)) return q.label
    }
    return null
  }

  const withinSelectionLimits = () => {
    return props.form.questions.every(q => {
      if (q.type !== 'checkbox' || q.maxSelections === undefined) return true
      const v = currentAnswers()[q.id]
      return !Array.isArray(v) || v.length <= q.maxSelections
    })
  }

  const ready = () => {
    if (!withinSelectionLimits()) return false
    return props.form.questions.filter(q => q.required).every(q => isQuestionAnswered(q))
  }

  /** 提交前合并 customInputs:radio 覆盖,checkbox 追加 */
  const mergeCustomInputs = (raw: Record<string, string | string[]>): Record<string, string | string[]> => {
    const merged = { ...raw }
    for (const q of props.form.questions) {
      if (!q.allowCustom) continue
      const custom = customInputs()[q.id]?.trim()
      if (!custom) continue
      if (q.type === 'radio') {
        merged[q.id] = custom
      } else if (q.type === 'checkbox') {
        const arr = Array.isArray(merged[q.id]) ? [...(merged[q.id] as string[])] : []
        if (!arr.includes(custom)) arr.push(custom)
        merged[q.id] = arr
      }
    }
    return merged
  }

  const handleSubmit = () => {
    if (isLocked() || !props.onSubmit) return
    if (!withinSelectionLimits()) return
    const missing = missingRequired()
    if (missing) return

    const merged = mergeCustomInputs(currentAnswers())
    const formatted = formatFormAnswers(props.form, merged)
    props.onSubmit(formatted, merged)
    setLocallySubmitted(true)
  }

  const renderQuestion = (q: FormQuestion) => {
    return (
      <div class="qf-field">
        <label class="qf-label">
          <span>{q.label}</span>
          <Show when={q.required}>
            <span class="qf-required" aria-label="必填">*</span>
          </Show>
        </label>

        <Show when={q.type === 'radio'}>
          <div class="qf-options">
            <For each={q.options}>
              {(opt: FormOption) => {
                const optionValue = opt.value ?? opt.label
                const selected = () => answers()[q.id] === optionValue
                return (
                  <button
                    type="button"
                    class={`qf-chip ${selected() ? 'qf-chip-on' : ''}`}
                    onClick={() => updateAnswer(q.id, optionValue)}
                    disabled={isLocked()}
                  >
                    {opt.label}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

        <Show when={q.type === 'checkbox'}>
          <div class="qf-options">
            <For each={q.options}>
              {(opt: FormOption) => {
                const optionValue = opt.value ?? opt.label
                const currentArray = () => Array.isArray(answers()[q.id]) ? answers()[q.id] as string[] : []
                const selected = () => currentArray().includes(optionValue)
                const atMax = () => q.maxSelections !== undefined && currentArray().length >= q.maxSelections && !selected()
                return (
                  <button
                    type="button"
                    class={`qf-chip ${selected() ? 'qf-chip-on' : ''}`}
                    onClick={() => toggleCheckbox(q.id, optionValue, q.maxSelections)}
                    disabled={isLocked() || atMax()}
                  >
                    {opt.label}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

        {/* 自定义输入:radio/checkbox 后追加"其他"输入框。allowCustom 默认 true(undefined 视为允许) */}
        <Show when={q.allowCustom && (q.type === 'radio' || q.type === 'checkbox')}>
          <input
            type="text"
            class="qf-input qf-custom-input"
            value={customInputs()[q.id] ?? ''}
            onInput={(e) => updateCustom(q.id, e.currentTarget.value, q.type)}
            placeholder="其他(自定义输入)…"
            disabled={isLocked()}
          />
        </Show>

        <Show when={q.type === 'text'}>
          <input
            type="text"
            class="qf-input"
            value={answers()[q.id] as string ?? ''}
            onInput={(e) => updateAnswer(q.id, e.currentTarget.value)}
            placeholder={q.placeholder ?? ''}
            disabled={isLocked()}
          />
        </Show>

        <Show when={q.type === 'textarea'}>
          <textarea
            class="qf-textarea"
            value={answers()[q.id] as string ?? ''}
            onInput={(e) => updateAnswer(q.id, e.currentTarget.value)}
            placeholder={q.placeholder ?? ''}
            rows={3}
            disabled={isLocked()}
          />
        </Show>
      </div>
    )
  }

  return (
    <div class={`quick-brief-form ${isLocked() ? 'quick-brief-form-locked' : ''}`} data-form-id={props.form.id}>
      <div class="quick-brief-form-head">
        <span class="quick-brief-form-icon" aria-hidden>?</span>
        <div class="quick-brief-form-titles">
          <div class="quick-brief-form-title">{props.form.title}</div>
          <div class="quick-brief-form-desc">{props.form.description}</div>
        </div>
        <Show when={isLocked()}>
          <span class="quick-brief-form-pill">已回答</span>
        </Show>
      </div>

      <div class="quick-brief-form-body">
        <For each={props.form.questions}>
          {(q: FormQuestion) => renderQuestion(q)}
        </For>
      </div>

      <div class="quick-brief-form-foot">
        <Show when={isLocked()} fallback={<span class="qf-hint">填写完必填项后提交</span>}>
          <span class="qf-locked-note">已锁定，无法修改</span>
        </Show>
        <Show when={!isLocked()}>
          <button
            type="button"
            class="qf-submit-btn primary"
            onClick={handleSubmit}
            disabled={!ready()}
          >
            提交
          </button>
        </Show>
      </div>
    </div>
  )
}