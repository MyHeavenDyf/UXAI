import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import type { IntentConfirmDimension, IntentConfirmResult } from "../../agents/proto-intent-confirm"
import { readPagePatternMd } from "../../utils/pattern-resource"
import { type BlockModuleItem, getBlockContent } from "../../utils/pattern-resource"
import "../../assets/style/chat/intent-confirm-card.css"

export type IntentConfirmAnswers = Record<string, { selections: string[]; supplement: string }>

export function IntentConfirmCard(props: {
  sessionId: string
  result: IntentConfirmResult
  blockMatches: BlockModuleItem[]
  blockMatching: boolean
  blockMatchError?: boolean
  initialStep?: "patterns" | "blocks"
  onMatchPattern: (selectedItem: IntentConfirmDimension | null) => void
  onConfirm: (answers: IntentConfirmAnswers, enrichedInput: string, selectedBlocks: BlockModuleItem[]) => void
}): JSX.Element {
  // 匹配到的 page pattern 列表
  const hasResults = createMemo(() => props.result.results.length > 0)
  // 当前卡片步骤：patterns = page pattern 选择，blocks = block 模板选择
  const [step, setStep] = createSignal<"patterns" | "blocks">(props.initialStep ?? "patterns")
  // 切换 session 时 initialStep 会变，同步更新 step（用户手动点上一步/下一步不受影响，因为只依赖 initialStep）
  createEffect(() => {
    setStep(props.initialStep ?? "patterns")
  })
  // 用户选中的 page pattern id（单选）
  const [selectedPatternId, setSelectedPatternId] = createSignal<string | null>(null)
  // 用户选中的 block 模板：category → name（每个分类互斥，只能选一个）
  const [selectedBlocks, setSelectedBlocks] = createSignal<Record<string, string>>({})
  // 预览模态框的图片 URL（点击放大缩略图时设置，null 表示关闭）
  const [previewModalUrl, setPreviewModalUrl] = createSignal<string | null>(null)

  // page pattern 步骤点「下一步」/「跳过」：拉取选中 item 的 md 文档，放到 content 上再传给回调
  async function handleBlockPatterns() {
    const found = props.result.results.find(r => r.id === selectedPatternId()) ?? null
    let selected = found
    if (found?.file) {
      const mdResult = await readPagePatternMd(found.file)
      if (mdResult.success && mdResult.content) {
        selected = { ...found, content: mdResult.content }
      } else {
        showToast({ title: "请求Pattern资源失败，请联系开发人员！" })
        return
      }
    }
    props.onMatchPattern(selected)
    setStep("blocks")
  }

  function toggleBlock(category: string, id: string) {
    setSelectedBlocks(prev => {
      const next = { ...prev }
      if (next[category] === id) {
        delete next[category]
      } else {
        next[category] = id
      }
      return next
    })
  }

  async function handleConfirm() {
    // const selectedIds = Object.values(selectedBlocks())
    // const blocks = props.blockMatches.filter(m => selectedIds.includes(m.id))
    // const blockPatterns = await getBlockContent({ results: blocks }, props.sessionId)
    const blockPatterns = {"results": 
    [
    {
        "id": 981,
        "description": "以分节卡片形式组织复杂的服务器配置信息，通过提示框、表单组及底部操作按钮，引导用户完成配置任务。",
        "name": "configGroupForm",
        "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/24711f06-6db2-400f-a2e3-bf202eb50077.zip",
        "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/24711f06-6db2-400f-a2e3-bf202eb50077_thumb.png",
        "category": "表单",
        "structure": "圆角卡片容器采用纵向 flex 布局，顶部为信息提示框（提示图标+supply 文本内容），中下部依次包含多个配置分节区（每节为标题行 + 原子表单控件），底部右侧对齐排列操作按钮组。",
        "content": {
            "rootId": "cfgShellConfigCard",
            "elements": [
                {
                    "id": "cfgShellConfigCard",
                    "component": "div",
                    "props": {
                        "className": "bg-surface-container-highest rounded-sm shadow-card p-6"
                    },
                    "children": [
                        "cfgFNoticeBox",
                        "cfgFBasicInfoSection",
                        "cfgFRestfulSection",
                        "cfgFSnmpSection",
                        "cfgFActionBtnRow"
                    ]
                },
                {
                    "id": "cfgFNoticeBox",
                    "component": "div",
                    "props": {
                        "className": "bg-primary-container rounded-xl p-4 flex items-start gap-2"
                    },
                    "children": [
                        "cfgFNoticeIcon",
                        "cfgFNoticeContent"
                    ]
                },
                {
                    "id": "cfgFNoticeIcon",
                    "component": "Icon",
                    "props": {
                        "name": {
                            "path": "/cfgNoticeInfo/infoIcon"
                        },
                        "color": "primary",
                        "className": "w-4 h-4 shrink-0"
                    }
                },
                {
                    "id": "cfgFNoticeContent",
                    "component": "div",
                    "props": {
                        "className": "flex flex-col gap-1"
                    },
                    "children": [
                        "cfgFNoticeLine1",
                        "cfgFNoticeLine2",
                        "cfgFNoticeLine3",
                        "cfgFNoticeLine4",
                        "cfgFNoticeLine5"
                    ]
                },
                {
                    "id": "cfgFNoticeLine1",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-primary-container",
                        "value": {
                            "path": "/cfgNoticeInfo/noticeLines/0"
                        }
                    }
                },
                {
                    "id": "cfgFNoticeLine2",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-primary-container",
                        "value": {
                            "path": "/cfgNoticeInfo/noticeLines/1"
                        }
                    }
                },
                {
                    "id": "cfgFNoticeLine3",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-primary-container",
                        "value": {
                            "path": "/cfgNoticeInfo/noticeLines/2"
                        }
                    }
                },
                {
                    "id": "cfgFNoticeLine4",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-primary-container",
                        "value": {
                            "path": "/cfgNoticeInfo/noticeLines/3"
                        }
                    }
                },
                {
                    "id": "cfgFNoticeLine5",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-primary-container",
                        "value": {
                            "path": "/cfgNoticeInfo/noticeLines/4"
                        }
                    }
                },
                {
                    "id": "cfgFBasicInfoSection",
                    "component": "div",
                    "props": {
                        "className": "mt-5"
                    },
                    "children": [
                        "cfgFBasicInfoGrid"
                    ]
                },
                {
                    "id": "cfgFBasicInfoGrid",
                    "component": "div",
                    "props": {
                        "className": "grid grid-cols-2 gap-x-[12rem] gap-y-4"
                    },
                    "children": [
                        "cfgFSysNameField",
                        "cfgFTargetSysField",
                        "cfgFSysAddrField",
                        "cfgFBackupAddrField",
                        "cfgFDescField"
                    ]
                },
                {
                    "id": "cfgFSysNameField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSysNameLabelWrap",
                        "cfgFSysNameInput"
                    ]
                },
                {
                    "id": "cfgFSysNameLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSysNameStar",
                        "cfgFSysNameLabelText"
                    ]
                },
                {
                    "id": "cfgFSysNameLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "系统名称"
                    }
                },
                {
                    "id": "cfgFSysNameStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSysNameInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/systemName"
                        },
                        "placeholder": "请输入系统名称",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFTargetSysField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFTargetSysLabelWrap",
                        "cfgFTargetSysInput"
                    ]
                },
                {
                    "id": "cfgFTargetSysLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFTargetSysStar",
                        "cfgFTargetSysLabelText"
                    ]
                },
                {
                    "id": "cfgFTargetSysLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "对接系统"
                    }
                },
                {
                    "id": "cfgFTargetSysStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFTargetSysInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/targetSystem"
                        },
                        "placeholder": "请输入对接系统标识",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSysAddrField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSysAddrLabelWrap",
                        "cfgFSysAddrInput"
                    ]
                },
                {
                    "id": "cfgFSysAddrLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSysAddrStar",
                        "cfgFSysAddrLabelText"
                    ]
                },
                {
                    "id": "cfgFSysAddrLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "系统地址"
                    }
                },
                {
                    "id": "cfgFSysAddrStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSysAddrInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/systemAddress"
                        },
                        "placeholder": "请输入HTTPS地址",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFBackupAddrField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFBackupAddrLabel",
                        "cfgFBackupAddrInput"
                    ]
                },
                {
                    "id": "cfgFBackupAddrLabel",
                    "component": "span",
                    "props": {
                        "className": "w-[104px] shrink-0 text-md text-on-surface",
                        "value": "备用地址"
                    }
                },
                {
                    "id": "cfgFBackupAddrInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/backupAddress"
                        },
                        "placeholder": "请输入备用地址",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFDescField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFDescLabel",
                        "cfgFDescInput"
                    ]
                },
                {
                    "id": "cfgFDescLabel",
                    "component": "span",
                    "props": {
                        "className": "w-[104px] shrink-0 text-md text-on-surface",
                        "value": "描述"
                    }
                },
                {
                    "id": "cfgFDescInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/description"
                        },
                        "placeholder": "请输入描述信息",
                        "autoSize": true,
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFRestfulSection",
                    "component": "div",
                    "props": {
                        "className": "mt-6"
                    },
                    "children": [
                        "cfgFRestfulSwitchRow",
                        "cfgFRestfulGrid"
                    ]
                },
                {
                    "id": "cfgFRestfulSwitchRow",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3 mb-4"
                    },
                    "children": [
                        "cfgFRestfulSwitchLabel",
                        "cfgFRestfulSwitch"
                    ]
                },
                {
                    "id": "cfgFRestfulSwitchLabel",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface w-[104px]",
                        "value": "Restful协议"
                    }
                },
                {
                    "id": "cfgFRestfulSwitch",
                    "component": "Switch",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/isRestfulEnabled"
                        }
                    }
                },
                {
                    "id": "cfgFRestfulGrid",
                    "component": "div",
                    "props": {
                        "className": "grid grid-cols-2 gap-x-[12rem] gap-y-4"
                    },
                    "children": [
                        "cfgFNorthPortField",
                        "cfgFUiPortField",
                        "cfgFRestUsernameField",
                        "cfgFRestPasswordField"
                    ]
                },
                {
                    "id": "cfgFNorthPortField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFNorthPortLabelWrap",
                        "cfgFNorthPortInput"
                    ]
                },
                {
                    "id": "cfgFNorthPortLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFNorthPortStar",
                        "cfgFNorthPortLabelText"
                    ]
                },
                {
                    "id": "cfgFNorthPortLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "北向端口号"
                    }
                },
                {
                    "id": "cfgFNorthPortStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFNorthPortInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/restNorthPort"
                        },
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFUiPortField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFUiPortLabelWrap",
                        "cfgFUiPortInput"
                    ]
                },
                {
                    "id": "cfgFUiPortLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFUiPortStar",
                        "cfgFUiPortLabelText"
                    ]
                },
                {
                    "id": "cfgFUiPortLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "UI端口号"
                    }
                },
                {
                    "id": "cfgFUiPortStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFUiPortInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/restUiPort"
                        },
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFRestUsernameField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFRestUsernameLabelWrap",
                        "cfgFRestUsernameInput"
                    ]
                },
                {
                    "id": "cfgFRestUsernameLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFRestUsernameStar",
                        "cfgFRestUsernameLabelText"
                    ]
                },
                {
                    "id": "cfgFRestUsernameLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "用户名"
                    }
                },
                {
                    "id": "cfgFRestUsernameStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFRestUsernameInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/restUsername"
                        },
                        "placeholder": "请输入用户名",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFRestPasswordField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFRestPasswordLabelWrap",
                        "cfgFRestPasswordInput"
                    ]
                },
                {
                    "id": "cfgFRestPasswordLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFRestPasswordStar",
                        "cfgFRestPasswordLabelText"
                    ]
                },
                {
                    "id": "cfgFRestPasswordLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "密码"
                    }
                },
                {
                    "id": "cfgFRestPasswordStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFRestPasswordInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/restPassword"
                        },
                        "placeholder": "请输入密码",
                        "password": true,
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpSection",
                    "component": "div",
                    "props": {
                        "className": "mt-6"
                    },
                    "children": [
                        "cfgFSnmpSwitchRow",
                        "cfgFSnmpGrid"
                    ]
                },
                {
                    "id": "cfgFSnmpSwitchRow",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3 mb-4"
                    },
                    "children": [
                        "cfgFSnmpSwitchLabel",
                        "cfgFSnmpSwitch"
                    ]
                },
                {
                    "id": "cfgFSnmpSwitchLabel",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface w-[104px]",
                        "value": "SNMP协议"
                    }
                },
                {
                    "id": "cfgFSnmpSwitch",
                    "component": "Switch",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/isSnmpEnabled"
                        }
                    }
                },
                {
                    "id": "cfgFSnmpGrid",
                    "component": "div",
                    "props": {
                        "className": "grid grid-cols-2 gap-x-[12rem] gap-y-4"
                    },
                    "children": [
                        "cfgFSnmpVersionField",
                        "cfgFSnmpIpField",
                        "cfgFSnmpPortField",
                        "cfgFSnmpSecurityField",
                        "cfgFSnmpAuthKeyField",
                        "cfgFSnmpAuthProtoField",
                        "cfgFSnmpEncAlgoField",
                        "cfgFSnmpEncKeyField",
                        "cfgFSnmpUsernameField",
                        "cfgFSnmpEncodingField"
                    ]
                },
                {
                    "id": "cfgFSnmpVersionField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpVersionLabelWrap",
                        "cfgFSnmpVersionSelect"
                    ]
                },
                {
                    "id": "cfgFSnmpVersionLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpVersionStar",
                        "cfgFSnmpVersionLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpVersionLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "协议版本"
                    }
                },
                {
                    "id": "cfgFSnmpVersionStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpVersionSelect",
                    "component": "Select",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpVersion"
                        },
                        "options": {
                            "path": "/cfgSnmpVersionOptions"
                        },
                        "placeholder": "请选择协议版本",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpIpField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpIpLabelWrap",
                        "cfgFSnmpIpInput"
                    ]
                },
                {
                    "id": "cfgFSnmpIpLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpIpStar",
                        "cfgFSnmpIpLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpIpLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "IP地址/域名"
                    }
                },
                {
                    "id": "cfgFSnmpIpStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpIpInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpIpAddress"
                        },
                        "placeholder": "请输入IP地址或域名",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpPortField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpPortLabelWrap",
                        "cfgFSnmpPortInput"
                    ]
                },
                {
                    "id": "cfgFSnmpPortLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpPortStar",
                        "cfgFSnmpPortLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpPortLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "端口"
                    }
                },
                {
                    "id": "cfgFSnmpPortStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpPortInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpPort"
                        },
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpSecurityField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpSecurityLabelWrap",
                        "cfgFSnmpSecuritySelect"
                    ]
                },
                {
                    "id": "cfgFSnmpSecurityLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpSecurityStar",
                        "cfgFSnmpSecurityLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpSecurityLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "安全等级"
                    }
                },
                {
                    "id": "cfgFSnmpSecurityStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpSecuritySelect",
                    "component": "Select",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpSecurityLevel"
                        },
                        "options": {
                            "path": "/cfgSnmpSecurityLevelOptions"
                        },
                        "placeholder": "请选择安全等级",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpAuthKeyField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpAuthKeyLabelWrap",
                        "cfgFSnmpAuthKeyInput"
                    ]
                },
                {
                    "id": "cfgFSnmpAuthKeyLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpAuthKeyStar",
                        "cfgFSnmpAuthKeyLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpAuthKeyLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "鉴权密钥"
                    }
                },
                {
                    "id": "cfgFSnmpAuthKeyStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpAuthKeyInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpAuthKey"
                        },
                        "placeholder": "1到255个字符",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpAuthProtoField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpAuthProtoLabelWrap",
                        "cfgFSnmpAuthProtoSelect"
                    ]
                },
                {
                    "id": "cfgFSnmpAuthProtoLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpAuthProtoStar",
                        "cfgFSnmpAuthProtoLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpAuthProtoLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "鉴权协议"
                    }
                },
                {
                    "id": "cfgFSnmpAuthProtoStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpAuthProtoSelect",
                    "component": "Select",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpAuthProtocol"
                        },
                        "options": {
                            "path": "/cfgSnmpAuthProtocolOptions"
                        },
                        "placeholder": "请选择鉴权协议",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpEncAlgoField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpEncAlgoLabelWrap",
                        "cfgFSnmpEncAlgoSelect"
                    ]
                },
                {
                    "id": "cfgFSnmpEncAlgoLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpEncAlgoStar",
                        "cfgFSnmpEncAlgoLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpEncAlgoLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "加密算法"
                    }
                },
                {
                    "id": "cfgFSnmpEncAlgoStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpEncAlgoSelect",
                    "component": "Select",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpEncryptAlgorithm"
                        },
                        "options": {
                            "path": "/cfgSnmpEncryptAlgorithmOptions"
                        },
                        "placeholder": "请选择加密算法",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpEncKeyField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpEncKeyLabelWrap",
                        "cfgFSnmpEncKeyInput"
                    ]
                },
                {
                    "id": "cfgFSnmpEncKeyLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpEncKeyStar",
                        "cfgFSnmpEncKeyLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpEncKeyLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "加密密钥"
                    }
                },
                {
                    "id": "cfgFSnmpEncKeyStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpEncKeyInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpEncryptKey"
                        },
                        "placeholder": "1到255个字符",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpUsernameField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpUsernameLabelWrap",
                        "cfgFSnmpUsernameInput"
                    ]
                },
                {
                    "id": "cfgFSnmpUsernameLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpUsernameStar",
                        "cfgFSnmpUsernameLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpUsernameLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "用户名"
                    }
                },
                {
                    "id": "cfgFSnmpUsernameStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpUsernameInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpUsername"
                        },
                        "placeholder": "请输入SNMP用户名",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFSnmpEncodingField",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-3"
                    },
                    "children": [
                        "cfgFSnmpEncodingLabelWrap",
                        "cfgFSnmpEncodingSelect"
                    ]
                },
                {
                    "id": "cfgFSnmpEncodingLabelWrap",
                    "component": "div",
                    "props": {
                        "className": "w-[104px] shrink-0 flex items-center gap-0.5"
                    },
                    "children": [
                        "cfgFSnmpEncodingStar",
                        "cfgFSnmpEncodingLabelText"
                    ]
                },
                {
                    "id": "cfgFSnmpEncodingLabelText",
                    "component": "span",
                    "props": {
                        "className": "text-md text-on-surface",
                        "value": "编码格式"
                    }
                },
                {
                    "id": "cfgFSnmpEncodingStar",
                    "component": "span",
                    "props": {
                        "className": "text-md text-error",
                        "value": "*"
                    }
                },
                {
                    "id": "cfgFSnmpEncodingSelect",
                    "component": "Select",
                    "props": {
                        "value": {
                            "path": "/cfgFormData/snmpEncodingFormat"
                        },
                        "options": {
                            "path": "/cfgSnmpEncodingFormatOptions"
                        },
                        "placeholder": "请选择编码格式",
                        "className": "flex-1"
                    }
                },
                {
                    "id": "cfgFActionBtnRow",
                    "component": "div",
                    "props": {
                        "className": "flex justify-end gap-3 mt-[156px]"
                    },
                    "children": [
                        "cfgFBtnCancel",
                        "cfgFBtnConnect",
                        "cfgFBtnConfirm"
                    ]
                },
                {
                    "id": "cfgFBtnCancel",
                    "component": "Button",
                    "props": {
                        "value": {
                            "path": "/cfgActionButtons/0/btnText"
                        },
                        "color": "default"
                    }
                },
                {
                    "id": "cfgFBtnConnect",
                    "component": "Button",
                    "props": {
                        "value": {
                            "path": "/cfgActionButtons/1/btnText"
                        },
                        "color": "default"
                    }
                },
                {
                    "id": "cfgFBtnConfirm",
                    "component": "Button",
                    "props": {
                        "value": {
                            "path": "/cfgActionButtons/2/btnText"
                        },
                        "color": "primary"
                    }
                }
            ],
            "state": {
                "cfgNoticeInfo": {
                    "infoIcon": "alert-circle",
                    "noticeLines": [
                        "1、系统地址将被用于页面跳转，请确保地址准确性，非法地址可能会导数安全风险。",
                        "2、对接APIC场累时，三方系统类型必须选择'APIC'，否则会导致后续runbook业务下发失数。",
                        "3、对接城控制场景，需要安装dtagent微服务。",
                        "4、鉴权协议HMAC_SHA和HMAC_MD5由于协议本身的限制。其安全性不高，建议选择安全性更高的HIMAC_SHA2_256，鉴权协议；加密算法CBC_DES和AES_128安全性不高，建议加密算法“使用安全性更高的AES_256以提升安全性。",
                        "5、配置SNMP协议对接需要确认 系统-系统设置-驱动管理 已配置snmp账户鉴权信息，请保证snmp协议的输入参数与驱动管理配置的账户鉴权参数一致。"
                    ]
                },
                "cfgFormData": {
                    "systemName": "Frabriclnsight01",
                    "targetSystem": "域控制器",
                    "systemAddress": "123.45.67.89",
                    "backupAddress": "10.0.0.1",
                    "description": "系统功能说明",
                    "isRestfulEnabled": true,
                    "restNorthPort": 8080,
                    "restUiPort": 8443,
                    "restUsername": "admin",
                    "restPassword": "abc123",
                    "isSnmpEnabled": true,
                    "snmpVersion": "SNMPv3",
                    "snmpIpAddress": "189.136.25.3",
                    "snmpPort": 60000,
                    "snmpSecurityLevel": "认证且加密",
                    "snmpAuthKey": "",
                    "snmpAuthProtocol": "HMAC_SHA2_512",
                    "snmpEncryptAlgorithm": "AES_256",
                    "snmpEncryptKey": "",
                    "snmpUsername": "admin",
                    "snmpEncodingFormat": "UTF-8"
                },
                "cfgSnmpVersionOptions": [
                    {
                        "label": "v1",
                        "value": "v1"
                    },
                    {
                        "label": "v2c",
                        "value": "v2c"
                    },
                    {
                        "label": "SNMPv3",
                        "value": "SNMPv3"
                    }
                ],
                "cfgSnmpSecurityLevelOptions": [
                    {
                        "label": "noAuthNoPriv",
                        "value": "noAuthNoPriv"
                    },
                    {
                        "label": "authNoPriv",
                        "value": "authNoPriv"
                    },
                    {
                        "label": "认证且加密",
                        "value": "认证且加密"
                    }
                ],
                "cfgSnmpAuthProtocolOptions": [
                    {
                        "label": "MD5",
                        "value": "MD5"
                    },
                    {
                        "label": "HMAC_SHA2_512",
                        "value": "HMAC_SHA2_512"
                    }
                ],
                "cfgSnmpEncryptAlgorithmOptions": [
                    {
                        "label": "DES",
                        "value": "DES"
                    },
                    {
                        "label": "AES_256",
                        "value": "AES_256"
                    }
                ],
                "cfgSnmpEncodingFormatOptions": [
                    {
                        "label": "UTF-8",
                        "value": "UTF-8"
                    },
                    {
                        "label": "GBK",
                        "value": "GBK"
                    },
                    {
                        "label": "GB2312",
                        "value": "GB2312"
                    },
                    {
                        "label": "ASCII",
                        "value": "ASCII"
                    }
                ],
                "cfgActionButtons": [
                    {
                        "btnText": "取消",
                        "btnType": "default"
                    },
                    {
                        "btnText": "连通性检测",
                        "btnType": "primary_outline"
                    },
                    {
                        "btnText": "确定",
                        "btnType": "primary"
                    }
                ]
            }
        }
    },
    {
        "id": 970,
        "description": "作为平台的主导航与全局控制中心，提供侧边菜单触发、核心业务跳转、常用功能快捷入口及用户会话管理，确保高效的平台操作体验。",
        "name": "iMasterHeader",
        "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/dd7d9d85-323e-4d09-8b5d-d022f7455a14.zip",
        "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/dd7d9d85-323e-4d09-8b5d-d022f7455a14_thumb.png",
        "category": "顶部导航",
        "structure": "固定的顶部水平布局，左侧为菜单触发按钮、Logo 及平台名称，中间包含主导航菜单（Navigation.Menu），右侧为快捷文字链接与包含用户头像的 Lucide 功能图标组。",
        "content": {
            "state": {
                "masLogoImage": "/history/ses_066747e27ffe0cfZX1DZoUtGtw/uploads/3a8ea61746c464ce.svg",
                "masPlatformName": "IMaster NCE-Campus",
                "masSelectedMenuKeys": [
                    "layout-dashboard"
                ],
                "masNavItems": [
                    {
                        "title": "工作台",
                        "key": "layout-dashboard",
                        "icon": "house"
                    },
                    {
                        "title": "大屏",
                        "key": "monitor",
                        "icon": "monitor"
                    }
                ],
                "masQuickLinks": [
                    "开局",
                    "资源中心",
                    "任务中心",
                    "系统"
                ],
                "masUserName": "Admin",
                "masAvatarImage": "/history/ses_066747e27ffe0cfZX1DZoUtGtw/uploads/1d40d700d4f4ae78.svg"
            },
            "rootId": "masHeaderZone",
            "elements": [
                {
                    "id": "masHeaderZone",
                    "component": "div",
                    "props": {
                        "className": "h-12 flex items-center bg-surface-container-highest shadow-sm px-4"
                    },
                    "children": [
                        "masHdrLeftSection",
                        "masHdrSpacer",
                        "masHdrRightSection"
                    ]
                },
                {
                    "id": "masHdrLeftSection",
                    "component": "div",
                    "props": {
                        "className": "flex items-center"
                    },
                    "children": [
                        "masHdrMenuIcon",
                        "masHdrLogoImg",
                        "masHdrPlatformName",
                        "masHdrVerticalDivider",
                        "masHdrNavMenu"
                    ]
                },
                {
                    "id": "masHdrMenuIcon",
                    "component": "Icon",
                    "props": {
                        "name": "menu",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface cursor-pointer"
                    }
                },
                {
                    "id": "masHdrLogoImg",
                    "component": "img",
                    "props": {
                        "src": {
                            "path": "/masLogoImage"
                        },
                        "alt": "NCE-Campus Logo",
                        "className": "w-[19px] h-auto object-contain ml-[12px] mr-[6px]"
                    }
                },
                {
                    "id": "masHdrPlatformName",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masPlatformName"
                        },
                        "className": "text-md text-on-surface whitespace-nowrap"
                    }
                },
                {
                    "id": "masHdrVerticalDivider",
                    "component": "div",
                    "props": {
                        "className": "w-px h-4 bg-divider ml-[16px]"
                    }
                },
                {
                    "id": "masHdrNavMenu",
                    "component": "Menu",
                    "props": {
                        "mode": "horizontal",
                        "selectedKeys": {
                            "path": "/masSelectedMenuKeys"
                        },
                        "items": {
                            "path": "/masNavItems"
                        },
                        "className": "border-0 bg-transparent"
                    }
                },
                {
                    "id": "masHdrSpacer",
                    "component": "div",
                    "props": {
                        "className": "flex-1"
                    }
                },
                {
                    "id": "masHdrRightSection",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-5"
                    },
                    "children": [
                        "masHdrQuickLinksGroup",
                        "masHdrIconsGroup",
                        "masHdrUserInfoGroup"
                    ]
                },
                {
                    "id": "masHdrQuickLinksGroup",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-5"
                    },
                    "children": [
                        "masHdrQuickLink1",
                        "masHdrQuickLink2",
                        "masHdrQuickLink3",
                        "masHdrQuickLink4"
                    ]
                },
                {
                    "id": "masHdrQuickLink1",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masQuickLinks/0"
                        },
                        "className": "text-md cursor-pointer hover:text-primary transition-colors"
                    }
                },
                {
                    "id": "masHdrQuickLink2",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masQuickLinks/1"
                        },
                        "className": "text-md cursor-pointer hover:text-primary transition-colors"
                    }
                },
                {
                    "id": "masHdrQuickLink3",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masQuickLinks/2"
                        },
                        "className": "text-md cursor-pointer hover:text-primary transition-colors"
                    }
                },
                {
                    "id": "masHdrQuickLink4",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masQuickLinks/3"
                        },
                        "className": "text-md cursor-pointer hover:text-primary transition-colors"
                    }
                },
                {
                    "id": "masHdrIconsGroup",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-5"
                    },
                    "children": [
                        "masHdrThemeIcon",
                        "masHdrLangIcon",
                        "masHdrHistoryIcon",
                        "masHdrHelpIcon",
                        "masHdrUserIcon"
                    ]
                },
                {
                    "id": "masHdrThemeIcon",
                    "component": "Icon",
                    "props": {
                        "name": "sun",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface-variant cursor-pointer"
                    }
                },
                {
                    "id": "masHdrLangIcon",
                    "component": "Icon",
                    "props": {
                        "name": "languages",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface-variant cursor-pointer"
                    }
                },
                {
                    "id": "masHdrHistoryIcon",
                    "component": "Icon",
                    "props": {
                        "name": "wallpaper",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface-variant cursor-pointer"
                    }
                },
                {
                    "id": "masHdrHelpIcon",
                    "component": "Icon",
                    "props": {
                        "name": "help-circle",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface-variant cursor-pointer"
                    }
                },
                {
                    "id": "masHdrUserIcon",
                    "component": "Icon",
                    "props": {
                        "name": "user",
                        "shape": "outline",
                        "className": "w-5 h-5 text-on-surface-variant cursor-pointer"
                    }
                },
                {
                    "id": "masHdrUserInfoGroup",
                    "component": "div",
                    "props": {
                        "className": "flex items-center -ml-3"
                    },
                    "children": [
                        "masHdrUserName",
                        "masHdrAvatarImg"
                    ]
                },
                {
                    "id": "masHdrUserName",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "/masUserName"
                        },
                        "className": "text-md text-on-surface font-medium"
                    }
                },
                {
                    "id": "masHdrAvatarImg",
                    "component": "img",
                    "props": {
                        "src": {
                            "path": "/masAvatarImage"
                        },
                        "alt": "用户头像",
                        "className": "w-6 h-6 rounded-full object-cover ml-5"
                    }
                }
            ]
        }
    },
    {
        "id": 980,
        "description": "提供设备发现的配置界面，支持手动与自动两种执行模式，通过 IP 段位录入和协议选择完成批量设备接入配置。",
        "name": "filteringScreenModule",
        "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/aaf6bba0-6e10-4842-b413-1e331ee6ec0a.zip",
        "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/aaf6bba0-6e10-4842-b413-1e331ee6ec0a_thumb.png",
        "category": "筛选/过滤",
        "structure": "圆角矩形卡片容器，内部包含带图标的标题区、水平页签（Tabs），页签内容为纵向 flex 表单布局，包含分段控制器（Segmented）和单选组（RadioGroup）控件，中下部为数据表格，底部右侧排列操作按钮。",
        "content": {
            "rootId": "fsmMainContentCard",
            "elements": [
                {
                    "id": "fsmMainContentCard",
                    "component": "div",
                    "props": {
                        "className": "bg-surface-container-highest shadow-card rounded p-inset"
                    },
                    "children": [
                        "fsmMainTitleRow",
                        "fsmMainTabs"
                    ]
                },
                {
                    "id": "fsmMainTitleRow",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-2 mb-section"
                    },
                    "children": [
                        "fsmMainTitleArrow",
                        "fsmMainTitleText"
                    ]
                },
                {
                    "id": "fsmMainTitleArrow",
                    "component": "Icon",
                    "props": {
                        "name": "chevron-up",
                        "shape": "outline",
                        "className": "w-5 h-5 cursor-pointer"
                    }
                },
                {
                    "id": "fsmMainTitleText",
                    "component": "span",
                    "props": {
                        "className": "text-xl font-bold text-on-surface",
                        "value": "发现配置"
                    }
                },
                {
                    "id": "fsmMainTabs",
                    "component": "Tabs",
                    "props": {
                        "activeKey": "manual",
                        "types": "line",
                        "className": ""
                    },
                    "children": [
                        "fsmMainTabManual",
                        "fsmMainTabAuto"
                    ]
                },
                {
                    "id": "fsmMainTabManual",
                    "component": "TabItem",
                    "props": {
                        "key": "manual",
                        "label": "手动执行",
                        "content": {
                            "componentId": "fsmMainTabContentArea"
                        }
                    }
                },
                {
                    "id": "fsmMainTabAuto",
                    "component": "TabItem",
                    "props": {
                        "key": "auto",
                        "label": "自动执行",
                        "content": {
                            "componentId": "fsmMainTabContentArea"
                        }
                    }
                },
                {
                    "id": "fsmMainTabContentArea",
                    "component": "div",
                    "props": {
                        "className": "flex flex-col gap-section pt-4"
                    },
                    "children": [
                        "fsmMainFormRow1",
                        "fsmMainFormRow2",
                        "fsmMainTable",
                        "fsmMainActionRow"
                    ]
                },
                {
                    "id": "fsmMainFormRow1",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-gutter"
                    },
                    "children": [
                        "fsmMainFormLabel1",
                        "fsmMainSegmented"
                    ]
                },
                {
                    "id": "fsmMainFormLabel1",
                    "component": "span",
                    "props": {
                        "className": "text-md font-medium text-on-surface w-28 shrink-0 text-on-surface-variant",
                        "value": "IP录入方式"
                    }
                },
                {
                    "id": "fsmMainSegmented",
                    "component": "Segmented",
                    "props": {
                        "value": {
                            "path": "/fsmIpInputMethod"
                        },
                        "options": [
                            "手动输入",
                            "文件导入"
                        ],
                        "orientation": "horizontal",
                        "size": "medium"
                    }
                },
                {
                    "id": "fsmMainFormRow2",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-gutter"
                    },
                    "children": [
                        "fsmMainFormLabel2",
                        "fsmMainRadioGroup"
                    ]
                },
                {
                    "id": "fsmMainFormLabel2",
                    "component": "span",
                    "props": {
                        "className": "text-md font-medium text-on-surface w-28 shrink-0 text-on-surface-variant",
                        "value": "IP类型&地址段"
                    }
                },
                {
                    "id": "fsmMainRadioGroup",
                    "component": "RadioGroup",
                    "props": {
                        "value": {
                            "path": "/fsmIpTypeAddress"
                        },
                        "options": [
                            {
                                "label": "IPv4",
                                "value": "IPv4"
                            },
                            {
                                "label": "IPv6",
                                "value": "IPv6"
                            }
                        ],
                        "orientation": "horizontal"
                    }
                },
                {
                    "id": "fsmMainTable",
                    "component": "Table",
                    "props": {
                        "rowKey": "id",
                        "dataSource": {
                            "path": "/fsmTableList"
                        },
                        "pagination": false,
                        "columns": [
                            {
                                "title": "IP地址段",
                                "dataIndex": "ipSegment"
                            },
                            {
                                "title": "SNMP协议类型",
                                "dataIndex": "snmpType",
                                "width": 160
                            },
                            {
                                "title": "SNMP协议",
                                "dataIndex": "snmpProtocol"
                            },
                            {
                                "title": "Stelnet协议",
                                "dataIndex": "stelnetProtocol"
                            },
                            {
                                "title": "Netconf协议",
                                "dataIndex": "netconfProtocol"
                            },
                            {
                                "title": "Grpc协议",
                                "dataIndex": "grpcProtocol"
                            },
                            {
                                "title": "操作",
                                "dataIndex": "operations",
                                "width": 100
                            }
                        ],
                        "className": "mb-4"
                    },
                    "children": {
                        "path": "/fsmTableList",
                        "componentId": "fsmMainTableRow"
                    }
                },
                {
                    "id": "fsmMainTableRow",
                    "component": "TableRow",
                    "children": [
                        "fsmMainIpSegmentCell",
                        "fsmMainSnmpTypeCell",
                        "fsmMainSnmpProtocolCell",
                        "fsmMainStelnetProtocolCell",
                        "fsmMainNetconfProtocolCell",
                        "fsmMainGrpcProtocolCell",
                        "fsmMainOperationsCell"
                    ],
                    "props": {}
                },
                {
                    "id": "fsmMainIpSegmentCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 w-full"
                    },
                    "children": [
                        "fsmMainIpSegmentRequired",
                        "fsmMainIpSegmentInput"
                    ]
                },
                {
                    "id": "fsmMainIpSegmentRequired",
                    "component": "span",
                    "props": {
                        "className": "text-error text-md",
                        "value": "*"
                    }
                },
                {
                    "id": "fsmMainIpSegmentInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "ipSegment"
                        },
                        "placeholder": "起始IP-结束IP",
                        "size": "small",
                        "className": "w-full"
                    }
                },
                {
                    "id": "fsmMainSnmpTypeCell",
                    "component": "RadioGroup",
                    "props": {
                        "value": {
                            "path": "snmpType"
                        },
                        "options": [
                            {
                                "label": "V2",
                                "value": "V2"
                            },
                            {
                                "label": "V3",
                                "value": "V3"
                            }
                        ],
                        "orientation": "horizontal",
                        "size": "small"
                    }
                },
                {
                    "id": "fsmMainSnmpProtocolCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 w-full"
                    },
                    "children": [
                        "fsmMainSnmpProtocolRequired",
                        "fsmMainSnmpProtocolInput"
                    ]
                },
                {
                    "id": "fsmMainSnmpProtocolRequired",
                    "component": "span",
                    "props": {
                        "className": "text-error text-md",
                        "value": "*"
                    }
                },
                {
                    "id": "fsmMainSnmpProtocolInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "snmpProtocol"
                        },
                        "size": "small",
                        "suffix": "more-horizontal",
                        "placeholder": "请选择",
                        "className": "w-full"
                    }
                },
                {
                    "id": "fsmMainStelnetProtocolCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 w-full"
                    },
                    "children": [
                        "fsmMainStelnetProtocolRequired",
                        "fsmMainStelnetProtocolInput"
                    ]
                },
                {
                    "id": "fsmMainStelnetProtocolRequired",
                    "component": "span",
                    "props": {
                        "className": "text-error text-md",
                        "value": "*"
                    }
                },
                {
                    "id": "fsmMainStelnetProtocolInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "stelnetProtocol"
                        },
                        "size": "small",
                        "suffix": "more-horizontal",
                        "placeholder": "请选择",
                        "className": "w-full"
                    }
                },
                {
                    "id": "fsmMainNetconfProtocolCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 w-full"
                    },
                    "children": [
                        "fsmMainNetconfProtocolRequired",
                        "fsmMainNetconfProtocolInput"
                    ]
                },
                {
                    "id": "fsmMainNetconfProtocolRequired",
                    "component": "span",
                    "props": {
                        "className": "text-error text-md",
                        "value": "*"
                    }
                },
                {
                    "id": "fsmMainNetconfProtocolInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "netconfProtocol"
                        },
                        "size": "small",
                        "suffix": "more-horizontal",
                        "placeholder": "请选择",
                        "className": "w-full"
                    }
                },
                {
                    "id": "fsmMainGrpcProtocolCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 w-full"
                    },
                    "children": [
                        "fsmMainGrpcProtocolRequired",
                        "fsmMainGrpcProtocolInput"
                    ]
                },
                {
                    "id": "fsmMainGrpcProtocolRequired",
                    "component": "span",
                    "props": {
                        "className": "text-error text-md",
                        "value": "*"
                    }
                },
                {
                    "id": "fsmMainGrpcProtocolInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "grpcProtocol"
                        },
                        "size": "small",
                        "suffix": "more-horizontal",
                        "placeholder": "请选择",
                        "className": "w-full"
                    }
                },
                {
                    "id": "fsmMainOperationsCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-4 justify-center"
                    },
                    "children": [
                        "fsmMainAddBtn",
                        "fsmMainDeleteBtn"
                    ]
                },
                {
                    "id": "fsmMainAddBtn",
                    "component": "Button",
                    "props": {
                        "icon": "plus-circle",
                        "size": "small",
                        "shape": "default"
                    }
                },
                {
                    "id": "fsmMainDeleteBtn",
                    "component": "Button",
                    "props": {
                        "icon": "trash-2",
                        "size": "small",
                        "shape": "default"
                    }
                },
                {
                    "id": "fsmMainActionRow",
                    "component": "div",
                    "props": {
                        "className": "flex justify-end items-center gap-3 mt-2"
                    },
                    "children": [
                        "fsmMainClearBtn",
                        "fsmMainExecuteBtn"
                    ]
                },
                {
                    "id": "fsmMainClearBtn",
                    "component": "Button",
                    "props": {
                        "value": "清空",
                        "color": "default"
                    }
                },
                {
                    "id": "fsmMainExecuteBtn",
                    "component": "Button",
                    "props": {
                        "value": "立即执行",
                        "color": "primary"
                    }
                }
            ],
            "state": {
                "fsmIpInputMethod": "手动输入",
                "fsmIpTypeAddress": "IPv4",
                "fsmTableList": [
                    {
                        "id": "row1",
                        "ipSegment": "",
                        "snmpType": "V3",
                        "snmpProtocol": "",
                        "stelnetProtocol": "",
                        "netconfProtocol": "",
                        "grpcProtocol": ""
                    }
                ]
            }
        }
    },
    {
        "id": 968,
        "description": "提供应用的全功能分类索引，通过层级折叠菜单管理不同业务模块，支持快速定位与切换，并包含底部收缩/折叠辅助操作。",
        "name": "expandSideBar",
        "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/f2f48284-063d-409d-ba93-035af578a2df.zip",
        "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/f2f48284-063d-409d-ba93-035af578a2df_thumb.png",
        "category": "侧边导航",
        "structure": "固定宽度的左侧垂直导航布局，内部采用弹性列布局（flex-col）且菜单区域支持纵向滚动，嵌套纵向折叠菜单（Navigation.Menu）与 Lucide 图标，底部包含固定的收缩控制按钮。",
        "content": {
            "state": {
                "esbSelectedMenuKeys": [],
                "esbOpenMenuKeys": [],
                "esbMenuItems": [
                    {
                        "title": "数据分析",
                        "key": "dashboard",
                        "icon": "layout-dashboard",
                        "children": [
                            {
                                "title": "概览",
                                "key": "overview"
                            },
                            {
                                "title": "分析",
                                "key": "analytics"
                            },
                            {
                                "title": "报告",
                                "key": "reports"
                            }
                        ]
                    },
                    {
                        "title": "用户管理",
                        "key": "user",
                        "icon": "users",
                        "children": [
                            {
                                "title": "用户列表",
                                "key": "list"
                            },
                            {
                                "title": "角色管理",
                                "key": "roles"
                            },
                            {
                                "title": "权限设置",
                                "key": "permissions"
                            }
                        ]
                    },
                    {
                        "title": "订单管理",
                        "key": "order",
                        "icon": "shopping-cart",
                        "children": [
                            {
                                "title": "全部订单",
                                "key": "all"
                            },
                            {
                                "title": "待处理",
                                "key": "pending"
                            },
                            {
                                "title": "历史订单",
                                "key": "history"
                            }
                        ]
                    },
                    {
                        "title": "商品管理",
                        "key": "product",
                        "icon": "package",
                        "children": [
                            {
                                "title": "商品目录",
                                "key": "catalog"
                            },
                            {
                                "title": "分类管理",
                                "key": "categories"
                            },
                            {
                                "title": "品牌管理",
                                "key": "brands"
                            }
                        ]
                    },
                    {
                        "title": "财务管理",
                        "key": "finance",
                        "icon": "dollar-sign",
                        "children": [
                            {
                                "title": "交易记录",
                                "key": "transactions"
                            },
                            {
                                "title": "发票管理",
                                "key": "invoices"
                            },
                            {
                                "title": "预算管理",
                                "key": "budget"
                            }
                        ]
                    },
                    {
                        "title": "内容管理",
                        "key": "content",
                        "icon": "file-text",
                        "children": [
                            {
                                "title": "文章管理",
                                "key": "articles"
                            },
                            {
                                "title": "页面管理",
                                "key": "pages"
                            },
                            {
                                "title": "评论管理",
                                "key": "comments"
                            }
                        ]
                    },
                    {
                        "title": "营销推广",
                        "key": "marketing",
                        "icon": "megaphone",
                        "children": [
                            {
                                "title": "活动管理",
                                "key": "campaigns"
                            },
                            {
                                "title": "优惠券",
                                "key": "coupons"
                            },
                            {
                                "title": "SEO设置",
                                "key": "seo"
                            }
                        ]
                    },
                    {
                        "title": "系统设置",
                        "key": "system",
                        "icon": "settings",
                        "children": [
                            {
                                "title": "基本设置",
                                "key": "general"
                            },
                            {
                                "title": "安全设置",
                                "key": "security"
                            },
                            {
                                "title": "操作日志",
                                "key": "logs"
                            }
                        ]
                    },
                    {
                        "title": "工具",
                        "key": "tools",
                        "icon": "wrench",
                        "children": [
                            {
                                "title": "数据库管理",
                                "key": "database"
                            },
                            {
                                "title": "缓存管理",
                                "key": "cache"
                            },
                            {
                                "title": "任务调度",
                                "key": "scheduler"
                            }
                        ]
                    },
                    {
                        "title": "帮助中心",
                        "key": "help",
                        "icon": "life-buoy",
                        "children": [
                            {
                                "title": "常见问题",
                                "key": "faq"
                            },
                            {
                                "title": "文档",
                                "key": "docs"
                            },
                            {
                                "title": "技术支持",
                                "key": "support"
                            }
                        ]
                    }
                ]
            },
            "rootId": "esbSidebarContainer",
            "elements": [
                {
                    "id": "esbSidebarContainer",
                    "component": "aside",
                    "props": {
                        "className": "w-[216px] h-full bg-surface-container-highest border-r border-divider flex flex-col"
                    },
                    "children": [
                        "esbSidebarMenuWrapper",
                        "esbSidebarFooter"
                    ]
                },
                {
                    "id": "esbSidebarMenuWrapper",
                    "component": "div",
                    "props": {
                        "className": "flex-1 overflow-y-auto"
                    },
                    "children": [
                        "esbSidebarMenu"
                    ]
                },
                {
                    "id": "esbSidebarMenu",
                    "component": "Menu",
                    "props": {
                        "mode": "vertical",
                        "selectedKeys": {
                            "path": "/esbSelectedMenuKeys"
                        },
                        "openKeys": {
                            "path": "/esbOpenMenuKeys"
                        },
                        "items": {
                            "path": "/esbMenuItems"
                        },
                        "className": "w-full border-0"
                    }
                },
                {
                    "id": "esbSidebarFooter",
                    "component": "div",
                    "props": {
                        "className": "ml-[14px] mb-[16px]"
                    },
                    "children": [
                        "esbSidebarRecycleBtn"
                    ]
                },
                {
                    "id": "esbSidebarRecycleBtn",
                    "component": "Button",
                    "props": {
                        "icon": "list-Chevrons-down-up",
                        "className": "w-5 h-5 hover:text-primary"
                    }
                }
            ]
        }
    },
    {
        "id": 976,
        "description": "集中展示工单全流程信息，通过步进条实时呈现当前位置，配合多维度筛选和流程操作，实现工单全生命周期的可视化跟踪与管理。",
        "name": "titleWorkOrderTable",
        "file": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/6c0c01a9-41ff-4de4-871a-c165420f8c8d.zip",
        "preview": "https://octo-beta.hdesign.huawei.com/lib-resource-service/static/file/image/6c0c01a9-41ff-4de4-871a-c165420f8c8d_thumb.jpg",
        "category": "列表/表格",
        "structure": "圆角卡片容器嵌套标题区、工具栏（搜索 Input、筛选 Dropdown、自动刷新 Switch、操作按钮）以及工单数据表格，表格内集成 Step 步进条组件展示流程状态，并为每行配置多操作按钮。",
        "content": {
            "rootId": "twoMainCardContainer",
            "elements": [
                {
                    "id": "twoMainCardContainer",
                    "component": "div",
                    "props": {
                        "className": "bg-surface-container-highest rounded-md"
                    },
                    "children": [
                        "twoCardSecInner"
                    ]
                },
                {
                    "id": "twoCardSecInner",
                    "component": "div",
                    "props": {
                        "className": "p-6 flex flex-col gap-4"
                    },
                    "children": [
                        "twoCardSecTitle",
                        "twoCardSecToolbarRow",
                        "twoMainWorkorderTable"
                    ]
                },
                {
                    "id": "twoCardSecTitle",
                    "component": "span",
                    "props": {
                        "value": "工单概览",
                        "className": "text-2xl text-on-surface"
                    }
                },
                {
                    "id": "twoCardSecToolbarRow",
                    "component": "div",
                    "props": {
                        "className": "flex items-center justify-between"
                    },
                    "children": [
                        "twoCardSecToolbarLeft",
                        "twoCardSecToolbarRight"
                    ]
                },
                {
                    "id": "twoCardSecToolbarLeft",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-6"
                    },
                    "children": [
                        "twoCardSecSearchInput",
                        "twoCardSecFilterDropdown"
                    ]
                },
                {
                    "id": "twoCardSecSearchInput",
                    "component": "Input",
                    "props": {
                        "value": {
                            "path": "/twoSearchValue"
                        },
                        "placeholder": "请输入搜索内容",
                        "suffix": "search",
                        "size": "medium",
                        "className": "w-74"
                    }
                },
                {
                    "id": "twoCardSecFilterDropdown",
                    "component": "Dropdown",
                    "props": {
                        "menu": [
                            {
                                "label": "全部线索",
                                "key": "all"
                            },
                            {
                                "label": "按线索类型",
                                "key": "byType"
                            },
                            {
                                "label": "按线索优先级",
                                "key": "byPriority"
                            },
                            {
                                "label": "按线索状态",
                                "key": "byStatus"
                            }
                        ],
                        "trigger": [
                            "click"
                        ],
                        "placement": "bottomLeft"
                    },
                    "children": [
                        "twoCardSecFilterTrigger"
                    ]
                },
                {
                    "id": "twoCardSecFilterTrigger",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-1 cursor-pointer select-none"
                    },
                    "children": [
                        "twoCardSecFilterText",
                        "twoCardSecFilterIcon"
                    ]
                },
                {
                    "id": "twoCardSecFilterText",
                    "component": "span",
                    "props": {
                        "value": "高级筛选",
                        "className": "text-md text-on-surface-variant"
                    }
                },
                {
                    "id": "twoCardSecFilterIcon",
                    "component": "Icon",
                    "props": {
                        "name": "chevron-down",
                        "shape": "outline",
                        "className": "w-4 h-4"
                    }
                },
                {
                    "id": "twoCardSecToolbarRight",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-2"
                    },
                    "children": [
                        "twoCardAutoRefresh",
                        "twoCardDivider",
                        "twoCardSecExportBtn",
                        "twoCardSecCreateBtn",
                        "twoCardSecRefreshIcon"
                    ]
                },
                {
                    "id": "twoCardAutoRefresh",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-2"
                    },
                    "children": [
                        "twoCardAutoRefreshText",
                        "twoCardAutoRefreshSwitch"
                    ]
                },
                {
                    "id": "twoCardAutoRefreshText",
                    "component": "div",
                    "props": {
                        "value": "自动刷新",
                        "className": "text-md"
                    }
                },
                {
                    "id": "twoCardAutoRefreshSwitch",
                    "component": "Switch",
                    "props": {
                        "value": {
                            "path": "twoCardAutoRefreshSwitchValue"
                        },
                        "size": "medium"
                    }
                },
                {
                    "id": "twoCardDivider",
                    "component": "Divider",
                    "props": {
                        "orientation": "vertical",
                        "className": "mx-2 w-px"
                    }
                },
                {
                    "id": "twoCardSecExportBtn",
                    "component": "Button",
                    "props": {
                        "value": "导出"
                    }
                },
                {
                    "id": "twoCardSecCreateBtn",
                    "component": "Button",
                    "props": {
                        "value": "创建",
                        "color": "primary"
                    }
                },
                {
                    "id": "twoCardSecRefreshIcon",
                    "component": "Icon",
                    "props": {
                        "name": "refresh-cw",
                        "shape": "outline",
                        "className": "w-4 h-4 text-on-surface-variant cursor-pointer ml-2"
                    }
                },
                {
                    "id": "twoMainWorkorderTable",
                    "component": "Table",
                    "props": {
                        "rowKey": "key",
                        "dataSource": {
                            "path": "/twoWorkorderList"
                        },
                        "columns": [
                            {
                                "title": "工单名称",
                                "dataIndex": "workorderName",
                                "minWidth": 120
                            },
                            {
                                "title": "工单状态",
                                "dataIndex": "status",
                                "minWidth": 50
                            },
                            {
                                "title": "流程",
                                "dataIndex": "process",
                                "minWidth": 120
                            },
                            {
                                "title": "应用服务名",
                                "dataIndex": "appService",
                                "minWidth": 50
                            },
                            {
                                "title": "创建人",
                                "dataIndex": "creator",
                                "minWidth": 50
                            },
                            {
                                "title": "审批组",
                                "dataIndex": "approvalGroup",
                                "minWidth": 50
                            },
                            {
                                "title": "审核人",
                                "dataIndex": "reviewer",
                                "minWidth": 30
                            },
                            {
                                "title": "创建时间",
                                "dataIndex": "createTime"
                            },
                            {
                                "title": "操作",
                                "dataIndex": "actions",
                                "minWidth": 120
                            }
                        ],
                        "className": "mb-4"
                    },
                    "children": {
                        "path": "/twoWorkorderList",
                        "componentId": "twoMainTableRow"
                    }
                },
                {
                    "id": "twoMainTableRow",
                    "component": "TableRow",
                    "children": [
                        "twoMainWorkorderNameCell",
                        "twoMainStatusCell",
                        "twoMainProcessCell",
                        "twoMainAppServiceCell",
                        "twoMainCreatorCell",
                        "twoMainApprovalGroupCell",
                        "twoMainReviewerCell",
                        "twoMainCreateTimeCell",
                        "twoMainActionsCell"
                    ],
                    "props": {}
                },
                {
                    "id": "twoMainWorkorderNameCell",
                    "component": "span",
                    "props": {
                        "className": "truncate inline-block max-w-full",
                        "value": {
                            "path": "workorderName"
                        }
                    }
                },
                {
                    "id": "twoMainStatusCell",
                    "component": "Tag",
                    "props": {
                        "value": {
                            "path": "status/text"
                        },
                        "color": {
                            "path": "status/color"
                        },
                        "size": "small"
                    }
                },
                {
                    "id": "twoMainProcessCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center w-full"
                    },
                    "children": [
                        "twoMainProcessSteps"
                    ]
                },
                {
                    "id": "twoMainProcessSteps",
                    "component": "Steps",
                    "props": {
                        "types": "dot",
                        "size": "small",
                        "className": "inline-flex w-full"
                    },
                    "children": {
                        "path": "process",
                        "componentId": "twoMainProcessStepItem"
                    }
                },
                {
                    "id": "twoMainProcessStepItem",
                    "component": "StepItem",
                    "props": {
                        "title": {
                            "path": "step"
                        },
                        "status": {
                            "path": "status"
                        },
                        "className": "text-xs"
                    }
                },
                {
                    "id": "twoMainAppServiceCell",
                    "component": "span",
                    "props": {
                        "className": "truncate inline-block max-w-full",
                        "value": {
                            "path": "appService"
                        }
                    }
                },
                {
                    "id": "twoMainCreatorCell",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "creator"
                        }
                    }
                },
                {
                    "id": "twoMainApprovalGroupCell",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "approvalGroup"
                        }
                    }
                },
                {
                    "id": "twoMainReviewerCell",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "reviewer"
                        }
                    }
                },
                {
                    "id": "twoMainCreateTimeCell",
                    "component": "span",
                    "props": {
                        "value": {
                            "path": "createTime"
                        }
                    }
                },
                {
                    "id": "twoMainActionsCell",
                    "component": "div",
                    "props": {
                        "className": "flex items-center gap-5"
                    },
                    "children": {
                        "path": "actions",
                        "componentId": "twoMainActionButton"
                    }
                },
                {
                    "id": "twoMainActionButton",
                    "component": "Button",
                    "props": {
                        "value": {
                            "path": "text"
                        },
                        "icon": {
                            "path": "icon"
                        },
                        "types": "link",
                        "size": "medium",
                        "iconPlacement": "start",
                        "className": "text-on-surface"
                    }
                }
            ],
            "state": {
                "twoSearchValue": "",
                "twoCardAutoRefreshSwitchValue": false,
                "twoWorkorderList": [
                    {
                        "key": 1,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "审核通过",
                            "color": "success"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "finish"
                            },
                            {
                                "step": "发放",
                                "status": "wait"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "李四",
                        "approvalGroup": "网络运维组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "send",
                                "text": "发放"
                            },
                            {
                                "icon": "refresh-cw",
                                "text": "重置"
                            }
                        ]
                    },
                    {
                        "key": 2,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "验证失败",
                            "color": "error"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "wait"
                            },
                            {
                                "step": "发放",
                                "status": "wait"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "王五",
                        "approvalGroup": "安全组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "trash-2",
                                "text": "废弃"
                            }
                        ]
                    },
                    {
                        "key": 3,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "发放失败",
                            "color": "error"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "finish"
                            },
                            {
                                "step": "发放",
                                "status": "finish"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "赵六",
                        "approvalGroup": "数据库组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "send",
                                "text": "发放"
                            },
                            {
                                "icon": "refresh-cw",
                                "text": "重置"
                            },
                            {
                                "icon": "trash-2",
                                "text": "废弃"
                            }
                        ]
                    },
                    {
                        "key": 4,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "审核驳回",
                            "color": "warning"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "wait"
                            },
                            {
                                "step": "发放",
                                "status": "wait"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "刘七",
                        "approvalGroup": "网络运维组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            }
                        ]
                    },
                    {
                        "key": 5,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "回滚失败",
                            "color": "#FA541C"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "wait"
                            },
                            {
                                "step": "审核",
                                "status": "wait"
                            },
                            {
                                "step": "发放",
                                "status": "finish"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "陈八",
                        "approvalGroup": "安全组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "send",
                                "text": "发放"
                            }
                        ]
                    },
                    {
                        "key": 6,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "验证中",
                            "color": "processing"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "wait"
                            },
                            {
                                "step": "发放",
                                "status": "wait"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "周九",
                        "approvalGroup": "数据库组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "trash-2",
                                "text": "废弃"
                            }
                        ]
                    },
                    {
                        "key": 7,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "发放中",
                            "color": "processing"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "finish"
                            },
                            {
                                "step": "发放",
                                "status": "finish"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "吴十",
                        "approvalGroup": "网络运维组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "send",
                                "text": "发放"
                            },
                            {
                                "icon": "refresh-cw",
                                "text": "重置"
                            }
                        ]
                    },
                    {
                        "key": 8,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "回滚中",
                            "color": "#13C2C2"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "wait"
                            },
                            {
                                "step": "审核",
                                "status": "finish"
                            },
                            {
                                "step": "发放",
                                "status": "wait"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "郑一",
                        "approvalGroup": "安全组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "trash-2",
                                "text": "废弃"
                            }
                        ]
                    },
                    {
                        "key": 9,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "发放成功",
                            "color": "success"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "finish"
                            },
                            {
                                "step": "审核",
                                "status": "finish"
                            },
                            {
                                "step": "发放",
                                "status": "finish"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "孙二",
                        "approvalGroup": "数据库组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            },
                            {
                                "icon": "send",
                                "text": "发放"
                            },
                            {
                                "icon": "refresh-cw",
                                "text": "重置"
                            },
                            {
                                "icon": "trash-2",
                                "text": "废弃"
                            }
                        ]
                    },
                    {
                        "key": 10,
                        "workorderName": "支付应用开通网络部门配合业务工单",
                        "status": {
                            "text": "回滚成功",
                            "color": "success"
                        },
                        "process": [
                            {
                                "step": "验证",
                                "status": "wait"
                            },
                            {
                                "step": "审核",
                                "status": "wait"
                            },
                            {
                                "step": "发放",
                                "status": "finish"
                            }
                        ],
                        "appService": "端口激活",
                        "creator": "钱三",
                        "approvalGroup": "网络运维组",
                        "reviewer": "--",
                        "createTime": "2025-06-30 14:34:46",
                        "actions": [
                            {
                                "icon": "eye",
                                "text": "详情"
                            }
                        ]
                    }
                ]
            }
        }
    }
]} as any
    props.onConfirm({}, "", blockPatterns.results)
  }

  return (
    <div class="ic-card">
      <div class="ic-card-head">
        <span class="ic-card-icon">?</span>
        <div class="ic-card-titles">
          <div class="ic-card-title">{step() === "patterns" ? "典型页面匹配" : "模块模板匹配"}</div>
          <div class="ic-card-desc">
            {step() === "patterns" ? "请选择最合适的典型页面模板" : "请选择需要使用的模块模板"}
          </div>
        </div>
      </div>

      {/* 步骤 1：page pattern 选择 */}
      <Show when={step() === "patterns"}>
        <div class="ic-card-body">
          <Show when={hasResults()} fallback={
            <div class="ic-card-empty">未匹配到合适的页面模板</div>
          }>
            <div class="ic-card-block-grid">
              <For each={props.result.results}>
                {(item) => {
                  const checked = () => selectedPatternId() === item.id
                  return (
                    <div
                      class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                      onClick={() => setSelectedPatternId(prev => prev === item.id ? null : item.id)}
                    >
                      <Show when={item.preview}>
                        <div class="ic-card-block-preview-wrap">
                          <img
                            class="ic-card-block-preview"
                            src={item.preview}
                            alt={item.name}
                          />
                          <button
                            class="ic-card-block-zoom"
                            onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(item.preview!) }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                          </button>
                        </div>
                      </Show>
                      <span class="ic-card-block-name">{item.name}</span>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="ic-card-foot">
          <Show when={hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns}>
              下一步
            </button>
          </Show>
          <Show when={!hasResults()}>
            <button class="ic-card-submit-btn" onClick={handleBlockPatterns}>
              跳过
            </button>
          </Show>
        </div>
      </Show>

      {/* 步骤 2：block 模板选择 */}
      <Show when={step() === "blocks"}>
        <div class="ic-card-body">
          <Show when={!props.blockMatching} fallback={
            <div class="ic-card-loading">
              <span class="ic-card-spinner" />
              <span>正在匹配模块模板...</span>
            </div>
          }>
            <Show when={!props.blockMatchError} fallback={
              <div class="ic-card-error">匹配出错，请重试</div>
            }>
              <Show when={props.blockMatches.length > 0} fallback={
                <div class="ic-card-empty">未匹配到合适的模块模板</div>
              }>
              <For each={Object.entries(
                props.blockMatches.reduce((acc, m) => {
                  const cat = m.category ?? "其他"
                  if (!acc[cat]) acc[cat] = []
                  acc[cat].push(m)
                  return acc
                }, {} as Record<string, typeof props.blockMatches>)
              )}>
                {([category, matches]) => (
                  <div class="ic-card-block-group">
                    <div class="ic-card-block-category">{category}</div>
                    <div class="ic-card-block-grid">
                      <For each={matches}>
                        {(match) => {
                          const cat = category
                          const checked = () => selectedBlocks()[cat] === match.id
                          return (
                            <div
                              class={`ic-card-block-card ${checked() ? "ic-card-block-card-on" : ""}`}
                              onClick={() => toggleBlock(cat, match.id)}
                            >
                              <Show when={match.preview}>
                                <div class="ic-card-block-preview-wrap">
                                  <img
                                    class="ic-card-block-preview"
                                    src={match.preview!}
                                    alt={match.name}
                                  />
                                  <button
                                    class="ic-card-block-zoom"
                                    onClick={(e) => { e.stopPropagation(); setPreviewModalUrl(match.preview!) }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
                                  </button>
                                </div>
                              </Show>
                              <span class="ic-card-block-name">{match.name}</span>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
            </Show>
          </Show>
        </div>

        <div class="ic-card-foot">
          <button class="ic-card-next-btn" onClick={() => setStep("patterns")} disabled={props.blockMatching}>
            上一步
          </button>
          <button class="ic-card-next-btn" onClick={() => props.onMatchPattern(null)} disabled={props.blockMatching}>
            重试
          </button>
          <Show when={!props.blockMatching}>
            <button class="ic-card-submit-btn" onClick={handleConfirm}>
              {props.blockMatchError || props.blockMatches.length === 0 ? "跳过" : "下一步"}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={previewModalUrl()}>
        <div class="ic-card-preview-modal" onClick={() => setPreviewModalUrl(null)}>
          <img class="ic-card-preview-modal-img" src={previewModalUrl()!} alt="preview" />
        </div>
      </Show>
    </div>
  )
}
