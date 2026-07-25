import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { agentThrow } from '../../utils/error-msg'
import {
  readPatternIndex,
} from '../../utils/pattern-resource'
import { PATTERN_BLOCK_FORMAT } from './schema'

const AGENT_NAME = "proto_pattern_block"

type ProtoPatternBlockInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  extra?: Record<string, unknown>
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_pattern_block(input: ProtoPatternBlockInput) {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input

  const theme = (input.extra?.designSystem as string) || "ICT3.1"
  const pagePattern = (input.extra?.pagePattern as string) ?? ""

  // const patterns = await readPatternIndex("block", theme)
  // if (!patterns || patterns.length === 0) {
  //   return { matches: [], current_step: "pattern_block" }
  // }

  const humanMessage = buildHumanMessage(userInput, pagePattern)
  debugger
  const result = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: PATTERN_BLOCK_FORMAT.schema,
  })

  const matchJson = extractJson(result.text)
  if (!matchJson) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Pattern Block did not return valid JSON")
  }
  // TODO: 拿到 modules[].description 后，去请求向量库获取每个 block 的真实信息（name/category/file/preview）
  // 等待文斌给函数
  // 这个description替换掉向量库上面的，然后还要把 structure也加进来！
  // 当前用 mock 数据模拟向量库返回
  const enrichedJson = {
    "modules": [
      {
        "description": "顶部导航栏（Top Navigation）：- 左段：Logo + 系统名称（\"NetOps 管理平台\"）。 - 中段：全局命令搜索框（Cmd + K 呼起）。 - 右段：环境标签（生产/测试/预发）、告警铃铛（带未读红点徽标）、全屏切换、用户头像下拉菜单（个人中心/退出）。",
        "name": "xxxxx-xxxxxx",
        "id": "1",
        "category": "AA",
        "file": "xxxx.xxx.zip",
        "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      },
      {
        "description": "左侧导航栏（Left Sidebar）：- 结构：支持多级树形菜单（父级可展开/收起）。 - 交互：根据当前路由 $route.path 自动高亮当前菜单项及其父级。",
        "name": "xxxxx-xxxxxx",
        "id": "2",
        "category": "BB",
        "file": "xxxx.xxx.zip",
        "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      },
      {
        "description": "带标签的表格（Tabs Table）：查看路由器掉线情况（升级替换默认基础表格），按状态维度（告警/故障/离线）水平切分数据。表格要显示 IP、设备型号、CPU占用，包含多选复选框、状态标签列、批量修改维保期操作按钮组与右侧固定操作列（宽度不低于 220px）。",
        "name": "xxxxx-xxxxxx",
        "category": "BB",
        "id": "3",
        "file": "xxxx.xxx.zip",
        "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      },
      {
        "description": "列表模式（List Mode）：查看昨天的故障日志（目的），采用垂直时间轴（Timeline）风格布局，包含左侧精确到秒的时间戳与右侧操作内容、结果状态元素。",
        "name": "xxxxx-xxxxxx",
        "category": "CC",
        "id": "4",
        "file": "xxxx.xxx.zip",
        "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      }
    ]
  }
  const returnValue = {
    matches: enrichedJson.modules,
    current_step: "pattern_block" as const,
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string, pagePattern: string): string {
  return `请结合【1.典型页面规范】与【2.用户业务需求描述】，输出一套完整、精准的 UI 模块描述列表（Module List）。

【1.典型页面规范】（保底硬性基线 Mandatory Baseline）==================================
${pagePattern}

【2.用户业务需求描述】（业务上下文与增量场景）==================================
${userInput}`
}





      // {
      //   "description": "顶部导航栏（Top Navigation）：- 左段：Logo + 系统名称（\"NetOps 管理平台\"）。 - 中段：全局命令搜索框（Cmd + K 呼起）。 - 右段：环境标签（生产/测试/预发）、告警铃铛（带未读红点徽标）、全屏切换、用户头像下拉菜单（个人中心/退出）。",
      //   "name": "xxxxx-xxxxxx",
      //   "id": "1",
      //   "category": "AA",
      //   "file": "xxxx.xxx.zip",
      //   "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      // },
      // {
      //   "description": "左侧导航栏（Left Sidebar）：- 结构：支持多级树形菜单（父级可展开/收起）。 - 交互：根据当前路由 $route.path 自动高亮当前菜单项及其父级。",
      //   "name": "xxxxx-xxxxxx",
      //   "id": "2",
      //   "category": "BB",
      //   "file": "xxxx.xxx.zip",
      //   "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      // },
      // {
      //   "description": "带标签的表格（Tabs Table）：查看路由器掉线情况（升级替换默认基础表格），按状态维度（告警/故障/离线）水平切分数据。表格要显示 IP、设备型号、CPU占用，包含多选复选框、状态标签列、批量修改维保期操作按钮组与右侧固定操作列（宽度不低于 220px）。",
      //   "name": "xxxxx-xxxxxx",
      //   "category": "BB",
      //   "id": "3",
      //   "file": "xxxx.xxx.zip",
      //   "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      // },
      // {
      //   "description": "列表模式（List Mode）：查看昨天的故障日志（目的），采用垂直时间轴（Timeline）风格布局，包含左侧精确到秒的时间戳与右侧操作内容、结果状态元素。",
      //   "name": "xxxxx-xxxxxx",
      //   "category": "CC",
      //   "id": "4",
      //   "file": "xxxx.xxx.zip",
      //   "preview": "https://gips3.baidu.com/it/u=3557221034,1819987898&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
      // }
    