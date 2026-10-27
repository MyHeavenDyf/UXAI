import { expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { readRecommendationImages } from "@/studio/prompt-recommendation-images"
import { createPreparation } from "@/studio/prompt-recommendation-budget"
import { tmpdir } from "../fixture/fixture"

const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")

test("reads only files belonging to the session uploads, including through symlinks", async () => {
  await using dir = await tmpdir()
  const folder = path.join(dir.path, ".octo", "session", "uploads")
  await mkdir(folder, { recursive: true })
  const local = path.join(folder, "image.png")
  const outside = path.join(dir.path, "other-session.webp")
  await Promise.all([writeFile(local, webp), writeFile(outside, webp)])
  expect(await readRecommendationImages([{ path: local }], folder)).toEqual([
    { path: local, mime: "image/webp", base64: webp.toString("base64") },
  ])
  const budget = createPreparation(undefined, 0)
  try {
    expect(() => budget.check()).toThrow("PREPARATION_TIMEOUT")
    await expect(readRecommendationImages([{ path: local }], folder, budget.signal)).rejects.toThrow(
      "PREPARATION_TIMEOUT",
    )
  } finally {
    budget.dispose()
  }
  await expect(readRecommendationImages([{ path: outside }], folder)).rejects.toThrow("INVALID_INPUT")
  await expect(readRecommendationImages([{ path: "image.png" }], folder)).rejects.toThrow("INVALID_INPUT")
  const link = path.join(folder, "outside.webp")
  await symlink(outside, link)
  await expect(readRecommendationImages([{ path: link }], folder)).rejects.toThrow("INVALID_INPUT")
  await expect(readRecommendationImages([{ path: path.join(folder, "missing.png") }], folder)).rejects.toThrow(
    "ATTACHMENT_READ_FAILED",
  )
})
