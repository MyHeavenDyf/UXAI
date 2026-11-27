import { deflateSync, inflateSync } from "node:zlib"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"

function decodePNG(buf: Buffer) {
  let off = 8
  let w = 0
  let h = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString("ascii", off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === "IHDR") {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error("expect 8-bit RGBA")
    } else if (type === "IDAT") idat.push(data)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0
      const b = prev ? prev[x] : 0
      const c = x >= 4 && prev ? prev[x - 4] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      cur[x] = v
    }
  }
  return { rgba: out, w, h }
}

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer) {
  let c = ~0
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePNG(rgba: Buffer, w: number, h: number) {
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function alphaBBox(rgba: Buffer, w: number, h: number, minA = 128) {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rgba[(y * w + x) * 4 + 3] >= minA) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function resizeRGBA(rgba: Buffer, sw: number, sh: number, dw: number, dh: number) {
  const dst = Buffer.alloc(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let dy = 0; dy < dh; dy++) {
    const sy = Math.max(0, Math.min(sh - 1, (dy + 0.5) * yr - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let dx = 0; dx < dw; dx++) {
      const sx = Math.max(0, Math.min(sw - 1, (dx + 0.5) * xr - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      let pr = 0
      let pg = 0
      let pb = 0
      let pa = 0
      for (let oy = 0; oy < 2; oy++) {
        const wy = oy === 0 ? 1 - fy : fy
        for (let ox = 0; ox < 2; ox++) {
          const wx = ox === 0 ? 1 - fx : fx
          const i = ((oy === 0 ? y0 : y1) * sw + (ox === 0 ? x0 : x1)) * 4
          const wt = wx * wy
          pa += rgba[i + 3] * wt
          pr += rgba[i] * rgba[i + 3] * wt
          pg += rgba[i + 1] * rgba[i + 3] * wt
          pb += rgba[i + 2] * rgba[i + 3] * wt
        }
      }
      const o = (dy * dw + dx) * 4
      if (pa < 1) continue
      dst[o] = Math.round(pr / pa)
      dst[o + 1] = Math.round(pg / pa)
      dst[o + 2] = Math.round(pb / pa)
      dst[o + 3] = Math.round(pa)
    }
  }
  return dst
}

function crop(rgba: Buffer, w: number, box: { x: number; y: number; w: number; h: number }) {
  const out = Buffer.alloc(box.w * box.h * 4)
  for (let y = 0; y < box.h; y++)
    rgba.copy(out, y * box.w * 4, ((y + box.y) * w + box.x) * 4, ((y + box.y) * w + box.x + box.w) * 4)
  return out
}

function extendRGB(buf: Buffer, w: number, h: number) {
  const out = Buffer.from(buf)
  for (let y = 0; y < h; y++) {
    let left = -1
    for (let x = 0; x < w; x++)
      if (out[(y * w + x) * 4 + 3] > 0) {
        left = x
        break
      }
    for (let x = 0; x < Math.max(left, 0); x++) out.copy(out, (y * w + x) * 4, (y * w + left) * 4, (y * w + left) * 4 + 4)
    let right = -1
    for (let x = w - 1; x >= 0; x--)
      if (out[(y * w + x) * 4 + 3] > 0) {
        right = x
        break
      }
    if (right >= 0 && right < w - 1) for (let x = right + 1; x < w; x++) out.copy(out, (y * w + x) * 4, (y * w + right) * 4, (y * w + right) * 4 + 4)
  }
  for (let x = 0; x < w; x++) {
    let top = -1
    for (let y = 0; y < h; y++)
      if (out[(y * w + x) * 4 + 3] > 0) {
        top = y
        break
      }
    for (let y = 0; y < Math.max(top, 0); y++) out.copy(out, (y * w + x) * 4, (top * w + x) * 4, (top * w + x) * 4 + 4)
    let bottom = -1
    for (let y = h - 1; y >= 0; y--)
      if (out[(y * w + x) * 4 + 3] > 0) {
        bottom = y
        break
      }
    if (bottom >= 0 && bottom < h - 1) for (let y = bottom + 1; y < h; y++) out.copy(out, (y * w + x) * 4, (bottom * w + x) * 4, (bottom * w + x) * 4 + 4)
  }
  return out
}

function applyInset(content: Buffer, box: { x: number; y: number; w: number; h: number }, mask: Buffer, canvas: number) {
  const ext = extendRGB(content, box.w, box.h)
  const out = Buffer.alloc(canvas * canvas * 4)
  for (let y = 0; y < box.h; y++) {
    ext.copy(out, ((y + box.y) * canvas + box.x) * 4, y * box.w * 4, (y + 1) * box.w * 4)
    for (let x = 0; x < box.w; x++) {
      out[(((y + box.y) * canvas + box.x + x) * 4) + 3] = mask[((y + box.y) * canvas + box.x + x) * 4 + 3]
    }
  }
  return out
}

const channels = ["dev", "beta", "prod"] as const
const variants = ["light", "dark"] as const
const tmp = join(tmpdir(), "octo-dock-mask")
mkdirSync(tmp, { recursive: true })
const swiftFile = join(tmp, "render-mask.swift")
writeFileSync(swiftFile, `import AppKit
let dir = "${tmp}/"
for channel in ${JSON.stringify([...channels])} {
  let img = NSImage(contentsOfFile: "icons/\\(channel)/icon.icns")!
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: 1024, height: 1024)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  img.draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024))
  NSGraphicsContext.restoreGraphicsState()
  let png = rep.representation(using: .png, properties: [:])!
  try! png.write(to: URL(fileURLWithPath: dir + "mask-\\(channel).png"))
  print("mask-\\(channel)")
}
`)
const rendered = spawnSync("swift", [swiftFile], { stdio: "inherit" })
if (rendered.status !== 0) throw new Error("swift mask rendering failed (requires macOS with Xcode command line tools)")

const insets = new Map<string, { hash: string; decoded: ReturnType<typeof decodePNG>; output: Buffer }>()

for (const channel of channels) {
  const mask = decodePNG(readFileSync(join(tmp, `mask-${channel}.png`)))
  const maskBox = alphaBBox(mask.rgba, mask.w, mask.h)
  if (maskBox.w !== maskBox.h || maskBox.x !== maskBox.y) throw new Error(`mask-${channel} unexpected shape`)
  for (const variant of variants) {
    const path = `icons/${channel}/dock-${variant}.png`
    const raw = readFileSync(path)
    const hash = Bun.hash.wyhash(raw).toString(16)
    const prior = insets.get(variant)
    if (prior && prior.hash === hash) {
      writeFileSync(path, prior.output)
      console.log(`copy ${path} (identical source)`)
      continue
    }
    const decoded = decodePNG(raw)
    const srcBox = alphaBBox(decoded.rgba, decoded.w, decoded.h, 128)
    if (srcBox.w / decoded.w <= maskBox.w / 1024 + 0.03) {
      insets.set(variant, { hash, decoded, output: raw })
      console.log(`keep ${path} (already inset)`)
      continue
    }
    const content = resizeRGBA(crop(decoded.rgba, decoded.w, srcBox), srcBox.w, srcBox.h, maskBox.w, maskBox.h)
    const output = encodePNG(applyInset(content, maskBox, mask.rgba, 1024), 1024, 1024)
    writeFileSync(path, output)
    insets.set(variant, { hash, decoded, output })
    console.log(`inset ${path} to ${maskBox.w}px with squircle mask`)
  }
}

const entries = variants.map((variant) => {
  const { rgba, w } = insets.get(variant)!.decoded
  const srcBox = alphaBBox(rgba, w, w, 128)
  const devMask = decodePNG(readFileSync(join(tmp, "mask-dev.png")))
  const mask512 = resizeRGBA(devMask.rgba, 1024, 1024, 512, 512)
  const box512 = alphaBBox(mask512, 512, 512)
  const content = resizeRGBA(crop(rgba, w, srcBox), srcBox.w, srcBox.h, box512.w, box512.h)
  const out = applyInset(content, box512, mask512, 512)
  return `  ${variant}: "data:image/png;base64,${encodePNG(out, 512, 512).toString("base64")}"`
})
writeFileSync("src/main/dock-icons.ts", `export const dockIcons = {\n${entries.join(",\n")},\n}\n`)
console.log("regenerated src/main/dock-icons.ts")

await $`git diff --stat -- icons src/main/dock-icons.ts`
