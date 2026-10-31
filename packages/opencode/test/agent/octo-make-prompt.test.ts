/**
 * octo_make 路由化后的系统提示词契约测试(feat/make-router,2026-10-22)。
 *
 * octo_make 改为路由 agent:需求分类(聊天/设计/项目/规划) + task 派发,不再自己生成产物;
 * 原设计生成职责拆到 octo_design(单文件设计产物),项目开发职责新建 octo_code(多文件),
 * 方案规划职责接入上游原生 plan agent(只读规划,2026-10-30)。
 * 本文件锁定三份提示词的关键契约,防回归。
 *
 * 运行: bun test test/agent/octo-make-prompt.test.ts(在 packages/opencode 下)
 */
import { describe, expect, test } from "bun:test"
import PROMPT_OCTO_MAKE from "../../src/agent/prompt/octo_make.txt"
import PROMPT_OCTO_DESIGN from "../../src/agent/prompt/octo_design.txt"
import PROMPT_OCTO_CODE from "../../src/agent/prompt/octo_code.txt"

describe("octo_make 路由提示词", () => {
  test("分类规则四类齐备", () => {
    expect(PROMPT_OCTO_MAKE).toContain("## A. 纯聊天/问答")
    expect(PROMPT_OCTO_MAKE).toContain("## B. 设计原型/单文件产物 → 派发给 octo_design")
    expect(PROMPT_OCTO_MAKE).toContain("## C. 完整项目开发 → 派发给 octo_code")
    expect(PROMPT_OCTO_MAKE).toContain("## D. 方案规划 → 派发给 plan")
  })

  test("五段式 task 派发模板齐备(防弱模型漏传产物目录路径)", () => {
    for (const section of ["【需求原文】", "【产物目录】", "【skill 约束】", "【方案内容】", "【交付要求】"]) {
      expect(PROMPT_OCTO_MAKE).toContain(section)
    }
    expect(PROMPT_OCTO_MAKE).toContain("一字不改地抄录")
  })

  test("迭代修改必须 task_id resume 复用子会话", () => {
    expect(PROMPT_OCTO_MAKE).toContain("必须传 task_id 参数复用同一子会话")
  })

  test("路由不产产物:禁止复述、禁止自己生成 artifact", () => {
    expect(PROMPT_OCTO_MAKE).toContain("禁止复述产物内容")
    expect(PROMPT_OCTO_MAKE).toContain("禁止自己生成 <artifact> 标签")
  })

  test("plan 派发契约:三目标派发 + 计划只读交付 + question 不代答 + 按计划执行回附方案", () => {
    expect(PROMPT_OCTO_MAKE).toContain("subagent_type 分别为 octo_design / octo_code / plan")
    // plan 的交付形式是纯文本计划,不写文件
    expect(PROMPT_OCTO_MAKE).toContain("派 plan 时写：输出结构化 Markdown 计划文本，不写任何文件")
    // plan 子代理 question 提问由用户在界面作答,路由不代答
    expect(PROMPT_OCTO_MAKE).toContain("不要代替用户回答")
    // 「按这个计划做」→ 判 B/C 并附完整计划
    expect(PROMPT_OCTO_MAKE).toContain("按这个计划做")
    expect(PROMPT_OCTO_MAKE).toContain("上一轮 plan 子代理产出的计划")
  })
})

describe("octo_design 提示词(承接原 octo_make 的设计生成职责)", () => {
  test("任务输入五段结构 + 产物目录路径约束保留", () => {
    expect(PROMPT_OCTO_DESIGN).toContain("[Artifact Folder]")
    expect(PROMPT_OCTO_DESIGN).toContain("[Existing artifacts in this session]")
    expect(PROMPT_OCTO_DESIGN).toContain("只能写入任务 prompt【产物目录】给出的目录内")
  })

  test("write/edit 返回路径规则保留(text/link artifact)", () => {
    expect(PROMPT_OCTO_DESIGN).toContain('`<artifact type="text/link">`')
    expect(PROMPT_OCTO_DESIGN).toContain("路径必须从任务 prompt 的 [Existing artifacts in this session] 列表中获取")
  })

  test("子代理约束:无法反问 + 禁止多文件项目结构", () => {
    expect(PROMPT_OCTO_DESIGN).toContain("你无法与用户对话")
    expect(PROMPT_OCTO_DESIGN).toContain("禁止生成多文件项目结构")
  })

  test("原代码工作区分支规则不回归(已拆给 octo_code)", () => {
    expect(PROMPT_OCTO_DESIGN).not.toContain("直接在项目内写文件")
    expect(PROMPT_OCTO_DESIGN).not.toContain("可直接对项目内文件使用 edit")
  })

  test("死引用 [Project artifacts] 不回归", () => {
    expect(PROMPT_OCTO_DESIGN).not.toContain("[Project artifacts]")
  })
})

describe("octo_code 提示词(多文件项目开发)", () => {
  test("两种工作场景分支", () => {
    expect(PROMPT_OCTO_CODE).toContain("## 场景 1：代码工作区")
    expect(PROMPT_OCTO_CODE).toContain("## 场景 2：普通工作区")
  })

  test("text/link 交付,禁止 artifact 输出代码全文", () => {
    expect(PROMPT_OCTO_CODE).toContain('<artifact type="text/link">')
    expect(PROMPT_OCTO_CODE).toContain("禁止用 `<artifact>` 输出代码全文")
  })

  test("代码完整可运行约束", () => {
    expect(PROMPT_OCTO_CODE).toContain("禁止占位 TODO")
    expect(PROMPT_OCTO_CODE).toContain("你无法与用户对话")
  })
})
