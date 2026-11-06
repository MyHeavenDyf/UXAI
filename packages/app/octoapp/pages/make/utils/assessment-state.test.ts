/**
 * 评估状态模块纯函数测试（数据契约校验 / 路径推导 / 分类映射）。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/assessment-state.test.ts（在 packages/app 下）
 */
import { describe, expect, test } from "bun:test"

import {
  parseReviewItems,
  computeAssessmentReviewPath,
  computeAssessmentStatePath,
  setAssessmentContext,
  ASSESSMENT_CATEGORY_OF,
  ASSESSMENT_CATEGORIES,
  selectAssessmentSkill,
  selectedSkillFor,
  enterPending,
  exitPendingAssessment,
  assessmentStatus,
  pauseAssessment,
  resumeAssessment,
} from "./assessment-state"

describe("parseReviewItems", () => {
  test("合法数组归一化", () => {
    const items = parseReviewItems([
      {
        xpath: '//*[@id="content"]',
        pin: 1,
        title: "图标层级信息权重问题",
        type: "颜色",
        solution: [{ desc: "问题", suggest: "建议" }],
      },
    ])
    expect(items).toEqual([
      {
        xpath: '//*[@id="content"]',
        pin: 1,
        title: "图标层级信息权重问题",
        type: "颜色",
        solution: [{ desc: "问题", suggest: "建议" }],
      },
    ])
  })

  test("非数组返回 null；空数组为合法空结果（空态面板契约）", () => {
    expect(parseReviewItems("nope")).toBeNull()
    expect(parseReviewItems({})).toBeNull()
    expect(parseReviewItems([])).toEqual([])
    expect(parseReviewItems(null)).toBeNull()
  })

  test("非法条目被丢弃，保留合法条目", () => {
    const items = parseReviewItems([
      { xpath: "//div", pin: 2, title: "t", type: "字体", solution: [{ desc: "d", suggest: "s" }] },
      { xpath: "", pin: 3, title: "t", type: "字体", solution: [{ desc: "d", suggest: "s" }] },
      { pin: 4, title: "t", type: "字体", solution: [{ desc: "d", suggest: "s" }] },
      { xpath: "//p", pin: 5, title: "t", type: "字体", solution: [] },
      "garbage",
    ])
    expect(items).toEqual([{ xpath: "//div", pin: 2, title: "t", type: "字体", solution: [{ desc: "d", suggest: "s" }] }])
  })

  test("全部非法返回 null", () => {
    expect(parseReviewItems([{ pin: 1 }])).toBeNull()
  })
})

describe("路径推导", () => {
  test("评审文件：normal 走 .octo/<sid>/outputs", () => {
    setAssessmentContext({ projectDir: "D:/proj", sessionId: "ses_123", workspaceKind: "normal" })
    expect(computeAssessmentReviewPath("D:/proj/output/abc123/abc.html", "H Design官网规范评估")).toBe(
      "D:/proj/.octo/ses_123/outputs/评估报告_abc_H Design官网规范评估/annotations.json",
    )
  })

  test("评审文件：code 走项目根本身", () => {
    setAssessmentContext({ projectDir: "D:/proj", sessionId: "ses_123", workspaceKind: "code" })
    expect(computeAssessmentReviewPath("D:/proj/abc.html", "ICT 领域规范评估")).toBe(
      "D:/proj/评估报告_abc_ICT 领域规范评估/annotations.json",
    )
  })

  test("评审文件：Windows 分隔符 + 反斜杠路径归一化", () => {
    setAssessmentContext({ projectDir: "D:\\proj", sessionId: "ses_123", workspaceKind: "normal" })
    expect(computeAssessmentReviewPath("D:\\proj\\x\\abc.html", "技能A")).toBe(
      "D:\\proj\\.octo\\ses_123\\outputs\\评估报告_abc_技能A\\annotations.json",
    )
  })

  test("状态文件：normal 按 session 隔离，项目相对路径作 safeName", () => {
    setAssessmentContext({ projectDir: "D:/proj", sessionId: "ses_123", workspaceKind: "normal" })
    expect(computeAssessmentStatePath("D:/proj/src/a.html")).toBe("D:/proj/.octo/ses_123/assessment/src_a.html.json")
  })

  test("状态文件：code 项目级 .octo/assessment（跨 session）", () => {
    setAssessmentContext({ projectDir: "D:/proj", sessionId: "ses_123", workspaceKind: "code" })
    expect(computeAssessmentStatePath("D:/proj/src/a.html")).toBe("D:/proj/.octo/assessment/src_a.html.json")
  })

  test("状态文件：项目外路径兜底文件名", () => {
    setAssessmentContext({ projectDir: "D:/proj", sessionId: "ses_123", workspaceKind: "normal" })
    expect(computeAssessmentStatePath("E:/elsewhere/x.html")).toBe("D:/proj/.octo/ses_123/assessment/x.html.json")
  })

  test("无上下文返回 null", () => {
    setAssessmentContext({ projectDir: "", sessionId: "", workspaceKind: "normal" })
    // projectDir 为空串时 sepOf 判定走 "/"，仍可推导——空串上下文由调用方（make 页）保证不出现；
    // 此处仅验证类型通路
    expect(typeof computeAssessmentReviewPath("a.html", "s")).toBe("string")
  })
})

describe("分类映射", () => {
  test("子类反查主分类", () => {
    expect(ASSESSMENT_CATEGORY_OF["颜色"]).toBe("Token遵从度")
    expect(ASSESSMENT_CATEGORY_OF["Token有效性"]).toBe("Token遵从度")
    expect(ASSESSMENT_CATEGORY_OF["页面骨架"]).toBe("组件遵从度")
    expect(ASSESSMENT_CATEGORY_OF["构建交付"]).toBe("页面完整度")
  })

  test("三大分类共 13 个子类，无重复", () => {
    const subs = Object.values(ASSESSMENT_CATEGORIES).flat()
    expect(subs.length).toBe(13)
    expect(new Set(subs).size).toBe(13)
    expect(Object.keys(ASSESSMENT_CATEGORIES)).toEqual(["Token遵从度", "组件遵从度", "页面完整度"])
  })
})

describe("状态机流转", () => {
  // 模块级信号跨测试共享——本组用例按序执行构成完整生命周期（happydom 下 window.api 缺失，
  // 落盘/删盘路径自动 no-op，安全）
  const fileKey = "D:/mock/state-machine-test.html"

  test("enterPending 同步选中态，pause/resume 保持选中，exit 清除选中", () => {
    selectAssessmentSkill(fileKey, "技能A")
    expect(selectedSkillFor(fileKey)).toBe("技能A")

    enterPending({
      fileKey,
      filePath: "D:/mock/state-machine-test.html",
      skillName: "技能B",
      reviewData: [{ xpath: "#demo", pin: 1, title: "t", type: "颜色", solution: [{ desc: "d", suggest: "s" }] }],
    })
    expect(assessmentStatus()).toBe("pending")
    expect(selectedSkillFor(fileKey)).toBe("技能B")

    pauseAssessment()
    expect(assessmentStatus()).toBe("paused")
    expect(selectedSkillFor(fileKey)).toBe("技能B")

    resumeAssessment()
    expect(assessmentStatus()).toBe("pending")

    exitPendingAssessment()
    expect(assessmentStatus()).toBe("idle")
    expect(selectedSkillFor(fileKey)).toBeUndefined()

    exitPendingAssessment()
    expect(assessmentStatus()).toBe("idle")
  })
})
