import { expect, spyOn, test } from "bun:test"
import { adjustStudioImageForEdit, prepareStudioImageOperation, prepareStudioUpscaleImage } from "./studio-edit-image"

function imageEnvironment(input: { width: number; height: number; invalid?: boolean; oversized?: boolean; bytes?: number }) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Image")!
  const NativeImage = globalThis.Image
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class extends NativeImage {
      get naturalWidth() {
        return input.width
      }
      get naturalHeight() {
        return input.height
      }
      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event(input.invalid ? "error" : "load")))
      }
    },
  })
  const sizes: number[][] = []
  const output = new Blob([input.bytes ? new Uint8Array(input.bytes) : input.oversized ? new Uint8Array(20 * 1024 * 1024 + 1) : "prepared-image"], {
    type: "image/jpeg",
  })
  const blob = spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    sizes.push([this.width, this.height])
    callback(output)
  })
  return {
    sizes,
    [Symbol.dispose]() {
      Object.defineProperty(globalThis, "Image", descriptor)
      blob.mockRestore()
    },
  }
}

test("upscale preparation bounds a large image, encodes its bytes and preserves its aspect ratio", async () => {
  using environment = imageEnvironment({ width: 12000, height: 8000 })
  const prepared = await prepareStudioUpscaleImage("https://example.test/8k.png")
  expect(environment.sizes).toEqual([[7500, 5000]])
  expect(prepared.sourceImage).toBe(`data:image/jpeg;base64,${btoa("prepared-image")}`)
  expect(prepared.aspectRatio).toBe("3:2")
})

test("upscale rejects an image still above 20MiB at the compression limit", async () => {
  using environment = imageEnvironment({ width: 8000, height: 8000, oversized: true })
  await expect(prepareStudioUpscaleImage("https://example.test/large.png")).rejects.toThrow("不能超过 20MiB")
  expect(environment.sizes.length).toBeGreaterThan(1)
  expect(environment.sizes.every(([width, height]) => width <= 7500 && height <= 7500)).toBe(true)
})

test.each([
  [12000, 8000, 7500, 5000, "3:2"],
  [20, 10, 100, 50, "16:9"],
] as const)("cutout bounds %sx%s to %sx%s and preserves the probed ratio", async (width, height, w, h, ratio) => {
  using environment = imageEnvironment({ width, height })
  const prepared = await prepareStudioImageOperation("https://example.test/cutout.png", "image.cutout")
  expect(environment.sizes).toEqual([[w, h]])
  expect(prepared.aspectRatio).toBe(ratio)
  expect(prepared.sourceImage).toBe(`data:image/jpeg;base64,${btoa("prepared-image")}`)
})

test("cutout enforces 8MiB even when its source would satisfy the upscale limit", async () => {
  using environment = imageEnvironment({ width: 1000, height: 1000, bytes: 8 * 1024 * 1024 + 1 })
  await expect(prepareStudioImageOperation("https://example.test/large.png", "image.cutout")).rejects.toThrow("不能超过 8MiB")
  expect(environment.sizes.length).toBeGreaterThan(1)
})

test("cutout rejects an aspect ratio that cannot meet both the 50px minimum and 7500px maximum", async () => {
  using environment = imageEnvironment({ width: 10000, height: 1 })
  await expect(prepareStudioImageOperation("https://example.test/wide.png", "image.cutout")).rejects.toThrow("不能超过 7500px")
  expect(environment.sizes).toEqual([])
})

test("inpaint raises the minimum side to 300px and keeps the 8MiB limit", async () => {
  using environment = imageEnvironment({ width: 20, height: 10 })
  await prepareStudioImageOperation("https://example.test/small.png", "image.inpaint")
  expect(environment.sizes).toEqual([[600, 300]])
})

test("inpaint rejects a prepared image larger than 8MiB", async () => {
  using environment = imageEnvironment({ width: 1000, height: 1000, bytes: 8 * 1024 * 1024 + 1 })
  await expect(prepareStudioImageOperation("https://example.test/large.png", "image.inpaint")).rejects.toThrow("不能超过 8MiB")
})

test("image decode failures stop editing before any output is produced", async () => {
  using environment = imageEnvironment({ width: 1000, height: 1000, invalid: true })
  await expect(prepareStudioUpscaleImage("https://example.test/unavailable.png")).rejects.toThrow(
    "Failed to load image",
  )
  expect(environment.sizes).toEqual([])
})

test("shared editing preparation rejects incompatible minimum and maximum dimensions", async () => {
  using environment = imageEnvironment({ width: 10000, height: 1 })
  await expect(
    adjustStudioImageForEdit("https://example.test/wide.png", {
      maxSize: 8 * 1024 * 1024,
      maxDimension: 7500,
      minSide: 300,
    }),
  ).rejects.toThrow("不能超过 7500px")
  expect(environment.sizes).toEqual([])
})
