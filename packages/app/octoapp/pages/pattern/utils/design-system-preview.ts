import { loadDesignSystem } from "./design-system-loader"

const previewCache = new Map<string, string>()

export async function getDesignSystemPreviewHtml(id: string): Promise<string> {
  const cached = previewCache.get(id)
  if (cached) return cached

  const { design, tokens } = await loadDesignSystem(id)
  const html = buildPreviewHtml(id, tokens, design)
  previewCache.set(id, html)
  return html
}

function extractColors(tokensCss: string): { name: string; value: string }[] {
  const colors: { name: string; value: string }[] = []
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tokensCss)) !== null) {
    colors.push({ name: m[1], value: m[2] })
  }
  return colors.slice(0, 20)
}

function extractFonts(tokensCss: string): string[] {
  const fonts: string[] = []
  const re = /font-family\s*:\s*([^;]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tokensCss)) !== null) {
    fonts.push(m[1].trim())
  }
  return [...new Set(fonts)].slice(0, 4)
}

function buildPreviewHtml(id: string, tokensCss: string, _design: string): string {
  const colors = extractColors(tokensCss)
  const fonts = extractFonts(tokensCss)
  const accentColor = colors.find((c) => c.name.includes("accent"))?.value ?? colors[0]?.value ?? "#0067D1"
  const bgColor = colors.find((c) => c.name === "bg")?.value ?? "#ffffff"
  const fgColor = colors.find((c) => c.name === "fg")?.value ?? "#1a1a1a"

  const colorSwatches = colors.map(
    (c) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <div style="width:20px;height:20px;border-radius:4px;background:${c.value};border:1px solid rgba(0,0,0,0.08);flex-shrink:0"></div>
      <span style="font-size:11px;color:#666;font-family:monospace">${c.name}</span>
      <span style="font-size:11px;color:#999;font-family:monospace;margin-left:auto">${c.value}</span>
    </div>`,
  ).join("")

  const fontSamples = fonts.map(
    (f) => `<div style="font-family:${f};font-size:16px;padding:6px 0;color:${fgColor}">
      The quick brown fox — ${f.split(",")[0].trim()}
    </div>`,
  ).join("")

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  ${tokensCss}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    padding: 16px;
    background: ${bgColor};
    color: ${fgColor};
    overflow-x: hidden;
  }
  .header {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(0,0,0,0.06);
    text-transform: capitalize;
  }
  .section { margin-bottom: 16px; }
  .section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #999;
    margin-bottom: 8px;
  }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: default;
    border: none;
  }
  .btn-primary { background: ${accentColor}; color: #fff; }
  .btn-outline { background: transparent; border: 1px solid ${accentColor}; color: ${accentColor}; }
  .btn-ghost { background: rgba(0,0,0,0.04); color: ${fgColor}; }
  .card {
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 8px;
    padding: 12px;
    margin-top: 8px;
  }
</style>
</head>
<body>
  <div class="header">${id.replace(/-/g, " ")}</div>

  ${colors.length > 0 ? `<div class="section">
    <div class="section-title">Colors</div>
    ${colorSwatches}
  </div>` : ""}

  ${fonts.length > 0 ? `<div class="section">
    <div class="section-title">Typography</div>
    ${fontSamples}
  </div>` : ""}

  <div class="section">
    <div class="section-title">Buttons</div>
    <div class="btn-row">
      <span class="btn btn-primary">Primary</span>
      <span class="btn btn-outline">Outline</span>
      <span class="btn btn-ghost">Ghost</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Card Sample</div>
    <div class="card">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">Sample Card</div>
      <div style="font-size:12px;color:#666">This is a preview of the design system's visual tokens applied to basic components.</div>
    </div>
  </div>
</body>
</html>`
}
