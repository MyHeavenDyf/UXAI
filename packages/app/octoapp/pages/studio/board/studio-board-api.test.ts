import { expect, spyOn, test } from "bun:test"
import { emptyBoard, newBoardCard } from "@opencode-ai/core/studio-board"
import { BoardRequestError, boardBackup, boardResponse, createBoardRequest, readBoardBackup } from "./studio-board-api"

function backupFixture() {
  const card = newBoardCard("pending-card", "image")
  return {
    creationID: crypto.randomUUID(),
    revision: 3,
    document: { ...emptyBoard(), cards: [card] },
    pending: [
      {
        sessionID: "original-session",
        capability: "image.generate" as const,
        prompt: "原始输入",
        extra: { userIdx: "original-user" },
        board: {
          cardID: card.id,
          submissionID: crypto.randomUUID(),
          revision: 2,
          snapshot: { prompt: "原始输入", settings: card.draft.settings, references: [] },
          replacedGenerationID: "original-generation",
        },
      },
    ],
  }
}

test.each([0.1, 2, 8])("board responses and local backups restore zoom %s", async (zoom) => {
  const backup = backupFixture()
  backup.document.viewport = { x: 320, y: -160, zoom }
  const key = `studio.board.test.zoom.${zoom}`
  localStorage.setItem(key, JSON.stringify(backup))
  const restored = await readBoardBackup(key)
  localStorage.removeItem(key)
  expect(restored?.document).toEqual(backup.document)
  expect(boardResponse.parse({ sessionID: "zoom-session", revision: 3, document: restored?.document }).document).toEqual(
    backup.document,
  )
})

test.each([false, true])(
  "board backups normalize legacy=%s pending requests without changing identity",
  async (legacy) => {
    const backup = backupFixture()
    const body = backup.pending[0]
    const key = "studio.board.test.backup"
    localStorage.setItem(
      key,
      JSON.stringify({
        ...backup,
        pending: legacy ? [{ cardID: body.board.cardID, body, submission: body.board }] : backup.pending,
      }),
    )
    try {
      const restored = (await readBoardBackup(key))!
      expect(restored?.pending).toEqual(backup.pending)
      expect(restored?.pending[0]).not.toHaveProperty("submission")
      expect(restored?.pending[0]).not.toHaveProperty("body")
      expect(boardBackup.parse(restored)).toEqual(restored)
    } finally {
      localStorage.removeItem(key)
    }
  },
)

test.each(["cardID", "submissionID", "revision", "snapshot", "replacedGenerationID"])(
  "legacy backup rejects conflicting %s and preserves the original storage",
  async (field) => {
    const backup = backupFixture()
    const body = backup.pending[0]
    const key = "studio.board.test.backup"
    const stored = JSON.stringify({
      ...backup,
      pending: [
        {
          cardID: body.board.cardID,
          body,
          submission: {
            ...body.board,
            [field]:
              field === "revision"
                ? 9
                : field === "snapshot"
                  ? { ...body.board.snapshot, prompt: "已修改" }
                  : crypto.randomUUID(),
          },
        },
      ],
    })
    localStorage.setItem(key, stored)
    try {
      await expect(readBoardBackup(key)).rejects.toThrow("提交信息不一致")
      expect(localStorage.getItem(key)).toBe(stored)
    } finally {
      localStorage.removeItem(key)
    }
  },
)

test("legacy backup rejects a card key that differs from the submitted request", () => {
  const backup = backupFixture()
  const body = backup.pending[0]
  expect(
    boardBackup.safeParse({
      ...backup,
      pending: [{ cardID: "another-card", body, submission: body.board }],
    }).success,
  ).toBe(false)
})

test("one board client reuses its scope and retains HTTP error status and readable messages", async () => {
  const requests: Request[] = []
  const responses = [
    Response.json({ data: { message: "保存冲突" } }, { status: 409 }),
    Response.json({ error: "网络暂时不可用" }, { status: 503 }),
    Response.json({ unexpected: true }, { status: 502 }),
    Response.json({ saved: true }),
  ]
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return responses.shift()!
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  try {
    const request = createBoardRequest({ url: "http://board.test", username: "user", password: "pass" }, "/测试")
    for (const expected of [
      { status: 409, message: "保存冲突" },
      { status: 503, message: "网络暂时不可用" },
      { status: 502, message: "请求失败 (502)" },
    ]) {
      const error: unknown = await request("/board", "PUT", { revision: 1 }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(BoardRequestError)
      expect(error).toMatchObject(expected)
    }
    expect(await request<{ saved: boolean }>("/board")).toEqual({ saved: true })
    expect(requests).toHaveLength(4)
    requests.forEach((request) => {
      expect(request.url).toBe("http://board.test/board")
      expect(request.headers.get("Authorization")).toBe("Basic dXNlcjpwYXNz")
      expect(request.headers.get("x-opencode-directory")).toBe(encodeURIComponent("/测试"))
    })
    expect(await requests[0].json()).toEqual({ revision: 1 })
    expect(requests[3].method).toBe("GET")
    await expect(createBoardRequest({ url: "" }, "/test")("/board")).rejects.toThrow("服务尚未就绪")
    expect(requests).toHaveLength(4)
  } finally {
    fetch.mockRestore()
  }
})
