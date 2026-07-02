export type HuiCodeInput = {
  planner: Record<string, unknown>
  mergedA2UI: Record<string, unknown>
}

export async function downloadHUICode(input: HuiCodeInput[]) {
  console.log("KKK！！！[download-hui-code] arrived", JSON.stringify(input).slice(0, 200))
  const code = "hello liukai and liliang"
}