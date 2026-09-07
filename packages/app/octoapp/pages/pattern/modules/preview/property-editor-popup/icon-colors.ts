/** 图标语义色：color/twoColor/threeColor 为十六进制色值列表（逗号分隔） */
export const iconColors: Record<string, { color: string; twoColor: string; threeColor: string }> = {
  default: { color: "#191919", twoColor: "#191919, #AEAEAE", threeColor: "#191919, #AEAEAE, #FFFFFF" },
  info: { color: "#2070F3", twoColor: "#2070F3, #8CA3FA", threeColor: "#2070F3, #8CA3FA, #EEF3FE" },
  error: { color: "#E02128", twoColor: "#E02128, #EE696F", threeColor: "#E02128, #EE696F, #FEE7E8" },
  alert: { color: "#F4840C", twoColor: "#F4840C, #F9B766", threeColor: "#F4840C, #F9B766, #FEF5E8" },
  warning: { color: "#FCC800", twoColor: "#FCC800, #FDE55C", threeColor: "#FCC800, #FDE55C, #FEFCE0" },
  success: { color: "#09AA71", twoColor: "#09AA71, #63D5A8", threeColor: "#09AA71, #63D5A8, #E7FBF2" },
  disabled: { color: "#AEAEAE", twoColor: "#AEAEAE, #777777", threeColor: "#AEAEAE, #777777, #FFFFFF" },
  brand: { color: "#0067D1", twoColor: "#0067D1, #5CA2E9", threeColor: "#0067D1, #5CA2E9, #E6F2FD" },
  rose: { color: "#E61866", twoColor: "#E61866, #F470AB", threeColor: "#E61866, #F470AB, #FEE5F2" },
  pink: { color: "#D41DBC", twoColor: "#D41DBC, #EB74DF", threeColor: "#D41DBC, #EB74DF, #FDE6FC" },
  purple: { color: "#B62BF7", twoColor: "#B62BF7, #CB8EFB", threeColor: "#B62BF7, #CB8EFB, #F7EDFE" },
  indigo: { color: "#715AFB", twoColor: "#715AFB, #A89FF9", threeColor: "#715AFB, #A89FF9, #EEEEFE" },
  cyan: { color: "#2CB8C9", twoColor: "#2CB8C9, #7DDFE7", threeColor: "#2CB8C9, #7DDFE7, #E8FCFD" },
  green: { color: "#62B42E", twoColor: "#62B42E, #A8DB81", threeColor: "#62B42E, #A8DB81, #F2FBE9" },
}

/** 语义色主色（color 首个色值）→ 十六进制色值 */
export const iconCssColor = (key: string) => (iconColors[key] ?? iconColors.default).color.split(",")[0].trim()
