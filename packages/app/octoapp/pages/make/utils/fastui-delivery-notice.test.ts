import { expect, test } from "bun:test"
import { fastuiDeliveryNotice } from "./fastui-delivery-notice"

type Input = Parameters<typeof fastuiDeliveryNotice>[0]
type Part = Input["sessions"][number]["parts"][number]

const workspaceDir = "D:/workspace"
const projectDir = `${workspaceDir}/chart`
const file = `${projectDir}/packages/portal/src/views/chart.vue`
const secondFile = `${projectDir}/packages/portal/src/views/summary.vue`
const marker = `${projectDir}/.octo-fastui.json`
const skill = (name = "chart-vue-creator", status = "completed"): Part => ({
  type: "tool",
  tool: "skill",
  state: { status, input: { name } },
})
const edit = (filePath: string, status = "completed"): Part => ({
  type: "tool",
  tool: "edit",
  state: { status, input: { filePath } },
})
const patch = (...files: string[]): Part => ({ type: "patch", files })

function detect(sessions: Input["sessions"], messageID = "msg_1", projectSkill?: string) {
  return fastuiDeliveryNotice({
    sessionID: "ses_main",
    messageID,
    workspaceDir,
    sessions,
    resolveProject: async (_sessionID, path) => path.startsWith(`${projectDir}/`)
      ? { name: "chart", projectDir, skill: projectSkill }
      : undefined,
  })
}

test("目标技能在主轮激活时汇总子任务文件，一轮返回一条交付通知", async () => {
  const sessions = [
    { sessionID: "ses_main", parts: [skill(), skill("fastui-vue-creator"), edit(file)] },
    { sessionID: "ses_child", parts: [edit(secondFile), patch(file, secondFile)] },
  ]
  expect(await detect(sessions)).toEqual({ key: "ses_main:msg_1", projects: ["chart"] })
  expect(await detect(sessions, "msg_2")).toEqual({ key: "ses_main:msg_2", projects: ["chart"] })
})

test("续改目标技能创建的工程无需再次调用技能，本轮只形成一条通知", async () => {
  const sessions = [
    { sessionID: "ses_main", parts: [edit(file)] },
    { sessionID: "ses_child", parts: [patch(file, secondFile)] },
  ]
  for (const projectSkill of ["chart-vue-creator", "fastui-vue-creator"]) {
    expect(await detect(sessions, "msg_followup", projectSkill))
      .toEqual({ key: "ses_main:msg_followup", projects: ["chart"] })
  }
  expect(await detect(sessions, "msg_followup", "other-skill")).toBeUndefined()
  expect(await detect([{ sessionID: "ses_main", parts: [] }], "msg_followup", "chart-vue-creator")).toBeUndefined()
})

test("脚本初始化模板不通知，随后脚本改动工程源码才形成通知", async () => {
  const scaffold = patch(marker, file)
  expect(await detect([{ sessionID: "ses_main", parts: [skill(), scaffold] }])).toBeUndefined()
  expect(await detect([{ sessionID: "ses_main", parts: [skill(), scaffold, patch("chart/packages/portal/src/views/chart.vue")] }]))
    .toEqual({ key: "ses_main:msg_1", projects: ["chart"] })
})

test("成功的 apply_patch 提供工程变更证据，未执行完的补丁不算", async () => {
  const parts = (status: string): Part[] => [skill(), {
    type: "tool",
    tool: "apply_patch",
    state: { status, metadata: { files: [{ filePath: file }] } },
  }]
  expect(await detect([{ sessionID: "ses_main", parts: parts("completed") }]))
    .toEqual({ key: "ses_main:msg_1", projects: ["chart"] })
  expect(await detect([{ sessionID: "ses_main", parts: parts("running") }])).toBeUndefined()
})

test("仅在子任务调用技能时，兄弟任务的写入不会触发通知", async () => {
  expect(await detect([
    { sessionID: "ses_main", parts: [] },
    { sessionID: "ses_child_1", parts: [skill("fastui-vue-creator")] },
    { sessionID: "ses_child_2", parts: [edit(file)] },
  ])).toBeUndefined()
  expect(await detect([
    { sessionID: "ses_main", parts: [] },
    { sessionID: "ses_child_1", parts: [skill("fastui-vue-creator"), patch(file)] },
  ])).toEqual({ key: "ses_main:msg_1", projects: ["chart"] })
})

test("市场展示名、失败调用、未完成写入、无归属文件和预览日志均不触发通知", async () => {
  const cases = [
    [skill("semi-chart-creator"), edit(file)],
    [skill("chart-vue-creator", "error"), edit(file)],
    [skill(), edit(file, "running")],
    [skill(), edit(`${workspaceDir}/another/packages/portal/src/view.vue`)],
    [skill(), patch(`${projectDir}/.octo-fastui/devserver.log`)],
  ]
  for (const parts of cases) expect(await detect([{ sessionID: "ses_main", parts }])).toBeUndefined()
})
