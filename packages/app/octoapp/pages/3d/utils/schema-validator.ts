import Ajv from "ajv"

const ajv = new Ajv()

/**
 * 校验 LLM 输出是否符合 schema。
 * 当前为 warning 模式：校验失败只打 warn 日志，不 throw。
 * 原因：3D 后端 agent 的 structured output 不可靠，LLM 经常漏字段或用不同字段名。
 * 严格模式会导致流程卡死。待 structured output 稳定后可切回 throw。
 */
export function validateSchema(data: unknown, schema: Record<string, unknown>, agent: string) {
  const validate = ajv.compile(schema)
  if (validate(data)) {
    console.log(`[${agent}] Schema validation passed`)
    return
  }
  const dataKeys = data && typeof data === "object" ? Object.keys(data as Record<string, unknown>) : []
  console.warn(`[${agent}] Schema validation WARN (non-blocking). Got keys: [${dataKeys.join(", ")}]. Errors: ${ajv.errorsText(validate.errors)}`)
}
