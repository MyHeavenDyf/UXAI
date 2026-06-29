/**
 * Parser for inline <question-form>...</question-form> blocks the agent
 * emits to ask the user a structured set of clarifying questions before
 * starting design work.
 *
 * Body must be JSON. Example:
 *
 *   <question-form id="discovery" title="快速简报">
 *   {
 *     "questions": [
 *       { "id": "output", "label": "产出类型", "type": "radio",
 *         "options": ["幻灯片 / 路演稿", "落地页", "多屏应用"],
 *         "required": true },
 *       { "id": "audience", "label": "目标用户", "type": "text",
 *         "placeholder": "例如：早期投资人" }
 *     ]
 *   }
 *   </question-form>
 *
 * Ported from open-design/apps/web/src/artifacts/question-form.ts
 * Simplified: removed direction-cards, select type, complex validation.
 */

export type QuestionType = 'radio' | 'checkbox' | 'text' | 'textarea'

export interface FormOption {
  label: string
  value: string
  description?: string
}

export interface FormQuestion {
  id: string
  label: string
  type: QuestionType
  options?: FormOption[]
  placeholder?: string
  required?: boolean
  help?: string
  defaultValue?: string | string[]
  maxSelections?: number
  allowCustom?: boolean
}

export interface QuestionForm {
  id: string
  title: string
  description?: string
  questions: FormQuestion[]
  submitLabel?: string
}

export type FormSegment =
  | { kind: 'text'; text: string }
  | { kind: 'form'; form: QuestionForm; raw: string }

const OPEN_RE = /<(question-form|ask-question)\b([^>]*)>/i

export function splitOnQuestionForms(input: string): FormSegment[] {
  const out: FormSegment[] = []
  let cursor = 0

  while (cursor < input.length) {
    const slice = input.slice(cursor)
    const m = OPEN_RE.exec(slice)
    if (!m) {
      out.push({ kind: 'text', text: slice })
      break
    }

    const tagName = (m[1] ?? 'question-form').toLowerCase()
    const closeTag = `</${tagName}>`
    const openStart = cursor + m.index
    const openEnd = openStart + m[0].length
    const closeIdx = findCloseTag(input, openEnd, closeTag)

    if (closeIdx === -1) {
      out.push({ kind: 'text', text: slice })
      break
    }

    if (openStart > cursor) {
      out.push({ kind: 'text', text: input.slice(cursor, openStart) })
    }

    const body = input.slice(openEnd, closeIdx)
    const attrs = parseAttrs(m[2] ?? '')
    const form = tryParseForm(body, attrs)
    const blockEnd = closeIdx + closeTag.length

    if (form) {
      out.push({ kind: 'form', form, raw: input.slice(openStart, blockEnd) })
    } else {
      out.push({ kind: 'text', text: input.slice(openStart, blockEnd) })
    }

    cursor = blockEnd
  }

  return out
}

function findCloseTag(input: string, from: number, closeTag: string): number {
  const closeLower = closeTag.toLowerCase()
  const tagLen = closeTag.length
  const maxStart = input.length - tagLen

  for (let i = from; i <= maxStart; i++) {
    if (input.slice(i, i + tagLen).toLowerCase() === closeLower) {
      return i
    }
  }

  return -1
}

function parseAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null

  while ((m = re.exec(raw)) !== null) {
    out[m[1] as string] = (m[2] ?? m[3] ?? '') as string
  }

  return out
}

function tryParseForm(body: string, attrs: Record<string, string>): QuestionForm | null {
  const trimmed = body.trim()
  if (!trimmed) return null

  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  let data: unknown
  try {
    data = JSON.parse(stripped)
  } catch {
    return null
  }

  if (!data || typeof data !== 'object') return null

  const obj = data as Record<string, unknown>
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : null
  if (!rawQuestions) return null

  const questions: FormQuestion[] = []
  rawQuestions.forEach((q, i) => {
    if (!q || typeof q !== 'object') return
    const qo = q as Record<string, unknown>

    const id = typeof qo.id === 'string' && qo.id.trim().length > 0
      ? qo.id.trim()
      : `q${i + 1}`

    const label = typeof qo.label === 'string' ? qo.label : id
    const type = normalizeType(qo.type)
    const options = parseOptions(qo.options)
    const placeholder = typeof qo.placeholder === 'string' ? qo.placeholder : undefined
    const help = typeof qo.help === 'string' ? qo.help : undefined
    const required = qo.required === true

    const maxSelections = typeof qo.maxSelections === 'number' &&
      Number.isInteger(qo.maxSelections) &&
      qo.maxSelections > 0
      ? qo.maxSelections
      : undefined

    const defaultValue = parseDefaultValue(qo, options)

    questions.push({
      id,
      label,
      type,
      ...(options ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(help ? { help } : {}),
      ...(required ? { required } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(maxSelections !== undefined && type === 'checkbox' ? { maxSelections } : {}),
    })
  })

  if (questions.length === 0) return null

  const id = attrs.id ?? (typeof obj.id === 'string' ? obj.id : 'discovery')
  const title = attrs.title ?? (typeof obj.title === 'string' ? obj.title : 'A few quick questions')
  const description = typeof obj.description === 'string' ? obj.description : undefined
  const submitLabel = typeof obj.submitLabel === 'string' ? obj.submitLabel : undefined

  return {
    id,
    title,
    questions,
    ...(description ? { description } : {}),
    ...(submitLabel ? { submitLabel } : {}),
  }
}

function normalizeType(raw: unknown): QuestionType {
  if (typeof raw !== 'string') return 'text'

  const lower = raw.toLowerCase().trim()

  if (lower === 'radio' || lower === 'single' || lower === 'choice') return 'radio'
  if (lower === 'checkbox' || lower === 'multi' || lower === 'multiple') return 'checkbox'
  if (lower === 'textarea' || lower === 'long' || lower === 'paragraph') return 'textarea'

  return 'text'
}

function parseOptions(raw: unknown): FormOption[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const options = raw
    .map(parseOption)
    .filter((option): option is FormOption => option !== null)

  return options.length > 0 ? options : undefined
}

function parseOption(raw: unknown): FormOption | null {
  if (typeof raw === 'string') {
    const label = raw.trim()
    return label.length > 0 ? { label, value: label } : null
  }

  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const label = typeof obj.label === 'string' ? obj.label.trim() : ''

  if (label.length === 0) return null

  const value = typeof obj.value === 'string' && obj.value.trim().length > 0
    ? obj.value.trim()
    : label

  const description = typeof obj.description === 'string' && obj.description.trim().length > 0
    ? obj.description.trim()
    : undefined

  return {
    label,
    value,
    ...(description ? { description } : {}),
  }
}

function parseDefaultValue(
  question: Record<string, unknown>,
  options: FormOption[] | undefined,
): string | string[] | undefined {
  const raw = typeof question.defaultValue === 'string' || Array.isArray(question.defaultValue)
    ? question.defaultValue
    : typeof question.default === 'string'
      ? question.default
      : undefined

  if (typeof raw === 'string') return formOptionValueForLabel({ options }, raw)

  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => formOptionValueForLabel({ options }, value))
  }

  return undefined
}

export function formatFormAnswers(
  form: QuestionForm,
  answers: Record<string, string | string[]>,
): string {
  const lines: string[] = []
  lines.push(`[快速简报]`)

  for (const q of form.questions) {
    const v = answers[q.id]
    let display: string

    if (Array.isArray(v)) {
      display = v.length > 0
        ? v.map((value) => formOptionDisplayForValue(q, value)).join(', ')
        : '(未填写)'
    } else if (typeof v === 'string') {
      display = v.trim().length > 0
        ? formOptionDisplayForValue(q, v.trim())
        : '(未填写)'
    } else {
      display = '(未填写)'
    }

    lines.push(`- ${q.label}: ${display}`)
  }

  return lines.join('\n')
}

function formOptionDisplayForValue(
  question: Pick<FormQuestion, 'options'>,
  value: string,
): string {
  const match = question.options?.find((option) => option.value === value || option.label === value)
  if (!match) return value
  if (match.value === match.label) return match.label
  return `${match.label} [value: ${match.value}]`
}

export function formOptionValueForLabel(
  question: Pick<FormQuestion, 'options'>,
  labelOrValue: string,
): string {
  const match = question.options?.find(
    (option) => option.value === labelOrValue || option.label === labelOrValue,
  )
  return match?.value ?? labelOrValue
}

export function parseSubmittedAnswers(
  form: QuestionForm,
  text: string,
): Record<string, string | string[]> | null {
  const lines = text.split('\n')
  const answers: Record<string, string | string[]> = {}

  for (const line of lines) {
    const m = line.match(/^-\s*(.+?):\s*(.+)$/)
    if (!m) continue

    const label = m[1].trim()
    const valueStr = m[2].trim()

    if (valueStr === '(未填写)' || valueStr === '(skipped)') continue

    const question = form.questions.find((q) => q.label === label)
    if (!question) continue

    if (question.type === 'checkbox') {
      const values = valueStr.split(', ').map((v) => formOptionValueForLabel(question, v.trim()))
      answers[question.id] = values
    } else {
      answers[question.id] = formOptionValueForLabel(question, valueStr)
    }
  }

  return Object.keys(answers).length > 0 ? answers : null
}