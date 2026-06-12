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
  const [locallySubmitted, setLocallySubmitted] = createSignal(false)

  const locked = props.submitted || locallySubmitted() || props.interactive === false || !props.onSubmit
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
    if (locked) return
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  const toggleCheckbox = (id: string, optionValue: string, maxSelections?: number) => {
    if (locked) return
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

  const missingRequired = () => {
    for (const q of props.form.questions) {
      if (!q.required) continue
      const v = currentAnswers()[q.id]
      if (Array.isArray(v) ? v.length === 0 : !(typeof v === 'string' && v.trim().length > 0)) {
        return q.label
      }
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
    return props.form.questions.filter(q => q.required).every(q => {
      const v = currentAnswers()[q.id]
      return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim().length > 0
    })
  }

  const handleSubmit = () => {
    if (locked || !props.onSubmit) return
    if (!withinSelectionLimits()) return
    const missing = missingRequired()
    if (missing) return

    const formatted = formatFormAnswers(props.form, currentAnswers())
    props.onSubmit(formatted, currentAnswers())
    setLocallySubmitted(true)
  }

  const renderQuestion = (q: FormQuestion) => {
    const value = currentAnswers()[q.id]

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
                const selected = value === optionValue
                return (
                  <button
                    type="button"
                    class={`qf-chip ${selected ? 'qf-chip-on' : ''}`}
                    onClick={() => updateAnswer(q.id, optionValue)}
                    disabled={locked}
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
                const currentArray = Array.isArray(value) ? value as string[] : []
                const selected = currentArray.includes(optionValue)
                const atMax = q.maxSelections !== undefined && currentArray.length >= q.maxSelections && !selected
                return (
                  <button
                    type="button"
                    class={`qf-chip ${selected ? 'qf-chip-on' : ''}`}
                    onClick={() => toggleCheckbox(q.id, optionValue, q.maxSelections)}
                    disabled={locked || atMax}
                  >
                    {opt.label}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

        <Show when={q.type === 'text'}>
          <input
            type="text"
            class="qf-input"
            value={typeof value === 'string' ? value : ''}
            onInput={(e) => updateAnswer(q.id, e.currentTarget.value)}
            placeholder={q.placeholder ?? ''}
            disabled={locked}
          />
        </Show>

        <Show when={q.type === 'textarea'}>
          <textarea
            class="qf-textarea"
            value={typeof value === 'string' ? value : ''}
            onInput={(e) => updateAnswer(q.id, e.currentTarget.value)}
            placeholder={q.placeholder ?? ''}
            rows={3}
            disabled={locked}
          />
        </Show>
      </div>
    )
  }

  return (
    <div class={`quick-brief-form ${locked ? 'quick-brief-form-locked' : ''}`} data-form-id={props.form.id}>
      <div class="quick-brief-form-head">
        <span class="quick-brief-form-icon" aria-hidden>?</span>
        <div class="quick-brief-form-titles">
          <div class="quick-brief-form-title">{props.form.title}</div>
          <div class="quick-brief-form-desc">{props.form.description}</div>
        </div>
        <Show when={locked}>
          <span class="quick-brief-form-pill">已回答</span>
        </Show>
      </div>

      <div class="quick-brief-form-body">
        <For each={props.form.questions}>
          {(q: FormQuestion) => renderQuestion(q)}
        </For>
      </div>

      <div class="quick-brief-form-foot">
        <Show when={locked} fallback={<span class="qf-hint">填写完必填项后提交</span>}>
          <span class="qf-locked-note">已锁定，无法修改</span>
        </Show>
        <Show when={!locked}>
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