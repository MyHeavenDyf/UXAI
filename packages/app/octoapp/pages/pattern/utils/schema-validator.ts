import Ajv from "ajv"

const ajv = new Ajv()

export function validateSchema(data: unknown, schema: Record<string, unknown>, agent: string) {
  const validate = ajv.compile(schema)
  if (validate(data)) {
    console.log(`[${agent}] Schema validation passed`)
    return 
  }
  throw new Error(`[${agent}] Schema validation failed: ${ajv.errorsText(validate.errors)}`)
}
