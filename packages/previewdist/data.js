window.__A2UI_DATA__ = {
  "state": {
    "pageTitle": "模型",
    "searchValue": "",
    "systemProvider": {
      "name": "Simetherm",
      "modelCount": "5个模型",
      "baseUrl": "https://api.openai.com/v1"
    },
    "customProviders": [
      {
        "logoIcon": "hexagon",
        "logoColor": "brand",
        "providerName": "Simetherm",
        "modelCount": "5个模型",
        "baseUrl": "https://api.openai.com/v1"
      },
      {
        "logoIcon": "sparkles",
        "logoColor": "indigo",
        "providerName": "OpenAI",
        "modelCount": "8个模型",
        "baseUrl": "https://api.openai.com/v1"
      },
      {
        "logoIcon": "aperture",
        "logoColor": "purple",
        "providerName": "Anthropic",
        "modelCount": "4个模型",
        "baseUrl": "https://api.anthropic.com/v1"
      },
      {
        "logoIcon": "brain",
        "logoColor": "cyan",
        "providerName": "DeepSeek",
        "modelCount": "3个模型",
        "baseUrl": "https://api.deepseek.com/v1"
      },
      {
        "logoIcon": "atom",
        "logoColor": "green",
        "providerName": "Qwen",
        "modelCount": "6个模型",
        "baseUrl": "https://dashscope.aliyuncs.com/v1"
      },
      {
        "logoIcon": "moon",
        "logoColor": "rose",
        "providerName": "Moonshot",
        "modelCount": "2个模型",
        "baseUrl": "https://api.moonshot.cn/v1"
      },
      {
        "logoIcon": "boxes",
        "logoColor": "pink",
        "providerName": "Zhipu",
        "modelCount": "5个模型",
        "baseUrl": "https://open.bigmodel.cn/api/paas/v4"
      }
    ]
  },
  "rootId": "pageShell",
  "elements": [
    {
      "id": "pageShell",
      "component": "div",
      "props": {
        "className": "flex h-screen bg-surface-container-lowest overflow-hidden"
      },
      "children": [
        "sidebarContainer",
        "mainContentArea"
      ]
    },
    {
      "id": "sidebarContainer",
      "component": "aside",
      "props": {
        "className": "w-[280px] shrink-0 flex flex-col bg-surface-container-highest border-r border-outline-variant"
      },
      "children": [
        "sidebarHeader",
        "sidebarBackRow",
        "sidebarScrollArea"
      ]
    },
    {
      "id": "sidebarHeader",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-4 py-4 shrink-0"
      },
      "children": [
        "sidebarLogoIcon",
        "sidebarLogoText"
      ]
    },
    {
      "id": "sidebarLogoIcon",
      "component": "Icon",
      "props": {
        "name": "hexagon",
        "color": "brand",
        "className": "w-5 h-5"
      }
    },
    {
      "id": "sidebarLogoText",
      "component": "span",
      "props": {
        "value": "GDE Claw",
        "className": "text-md font-semibold text-on-surface"
      }
    },
    {
      "id": "sidebarBackRow",
      "component": "div",
      "props": {
        "className": "flex items-center gap-1 px-4 py-2 shrink-0"
      },
      "children": [
        "sidebarBackIcon",
        "sidebarBackText"
      ]
    },
    {
      "id": "sidebarBackIcon",
      "component": "Icon",
      "props": {
        "name": "chevron-left",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarBackText",
      "component": "span",
      "props": {
        "value": "返回",
        "className": "text-sm text-on-surface-variant"
      }
    },
    {
      "id": "sidebarScrollArea",
      "component": "div",
      "props": {
        "className": "flex-1 overflow-y-auto flex flex-col gap-4 px-2 py-2"
      },
      "children": [
        "sidebarBlockPersonal",
        "sidebarBlockIntegration",
        "sidebarBlockSecurity"
      ]
    },
    {
      "id": "sidebarBlockPersonal",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-0.5"
      },
      "children": [
        "sidebarPersonalTitle",
        "sidebarPersonalOptGeneral",
        "sidebarPersonalOptMemory",
        "sidebarPersonalOptModel",
        "sidebarPersonalOptTools",
        "sidebarPersonalOptRunConfig",
        "sidebarPersonalOptToken"
      ]
    },
    {
      "id": "sidebarPersonalTitle",
      "component": "span",
      "props": {
        "value": "个人",
        "className": "px-3 pt-1 pb-0.5 text-xs font-medium text-on-surface-variant"
      }
    },
    {
      "id": "sidebarPersonalOptGeneral",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarPersonalOptGeneralIcon",
        "sidebarPersonalOptGeneralText"
      ]
    },
    {
      "id": "sidebarPersonalOptGeneralIcon",
      "component": "Icon",
      "props": {
        "name": "sliders-horizontal",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptGeneralText",
      "component": "span",
      "props": {
        "value": "通用",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarPersonalOptMemory",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarPersonalOptMemoryIcon",
        "sidebarPersonalOptMemoryText"
      ]
    },
    {
      "id": "sidebarPersonalOptMemoryIcon",
      "component": "Icon",
      "props": {
        "name": "brain",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptMemoryText",
      "component": "span",
      "props": {
        "value": "记忆",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarPersonalOptModel",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm bg-primary-container text-on-primary-container font-medium"
      },
      "children": [
        "sidebarPersonalOptModelIcon",
        "sidebarPersonalOptModelText"
      ]
    },
    {
      "id": "sidebarPersonalOptModelIcon",
      "component": "Icon",
      "props": {
        "name": "boxes",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptModelText",
      "component": "span",
      "props": {
        "value": "模型",
        "className": "text-sm text-on-primary-container font-medium"
      }
    },
    {
      "id": "sidebarPersonalOptTools",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarPersonalOptToolsIcon",
        "sidebarPersonalOptToolsText"
      ]
    },
    {
      "id": "sidebarPersonalOptToolsIcon",
      "component": "Icon",
      "props": {
        "name": "wrench",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptToolsText",
      "component": "span",
      "props": {
        "value": "内置工具",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarPersonalOptRunConfig",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarPersonalOptRunConfigIcon",
        "sidebarPersonalOptRunConfigText"
      ]
    },
    {
      "id": "sidebarPersonalOptRunConfigIcon",
      "component": "Icon",
      "props": {
        "name": "play",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptRunConfigText",
      "component": "span",
      "props": {
        "value": "运行配置",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarPersonalOptToken",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarPersonalOptTokenIcon",
        "sidebarPersonalOptTokenText"
      ]
    },
    {
      "id": "sidebarPersonalOptTokenIcon",
      "component": "Icon",
      "props": {
        "name": "coins",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarPersonalOptTokenText",
      "component": "span",
      "props": {
        "value": "Token消耗统计",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarBlockIntegration",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-0.5"
      },
      "children": [
        "sidebarIntegrationTitle",
        "sidebarIntegrationOptChannel",
        "sidebarIntegrationOptMcp"
      ]
    },
    {
      "id": "sidebarIntegrationTitle",
      "component": "span",
      "props": {
        "value": "集成",
        "className": "px-3 pt-1 pb-0.5 text-xs font-medium text-on-surface-variant"
      }
    },
    {
      "id": "sidebarIntegrationOptChannel",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarIntegrationOptChannelIcon",
        "sidebarIntegrationOptChannelText"
      ]
    },
    {
      "id": "sidebarIntegrationOptChannelIcon",
      "component": "Icon",
      "props": {
        "name": "radio",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarIntegrationOptChannelText",
      "component": "span",
      "props": {
        "value": "频道",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarIntegrationOptMcp",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarIntegrationOptMcpIcon",
        "sidebarIntegrationOptMcpText"
      ]
    },
    {
      "id": "sidebarIntegrationOptMcpIcon",
      "component": "Icon",
      "props": {
        "name": "plug",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarIntegrationOptMcpText",
      "component": "span",
      "props": {
        "value": "MCP",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarBlockSecurity",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-0.5"
      },
      "children": [
        "sidebarSecurityTitle",
        "sidebarSecurityOptSetting",
        "sidebarSecurityOptUsage"
      ]
    },
    {
      "id": "sidebarSecurityTitle",
      "component": "span",
      "props": {
        "value": "安全",
        "className": "px-3 pt-1 pb-0.5 text-xs font-medium text-on-surface-variant"
      }
    },
    {
      "id": "sidebarSecurityOptSetting",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarSecurityOptSettingIcon",
        "sidebarSecurityOptSettingText"
      ]
    },
    {
      "id": "sidebarSecurityOptSettingIcon",
      "component": "Icon",
      "props": {
        "name": "shield-check",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarSecurityOptSettingText",
      "component": "span",
      "props": {
        "value": "安全设置",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "sidebarSecurityOptUsage",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 px-3 py-2 rounded-base text-sm text-on-surface"
      },
      "children": [
        "sidebarSecurityOptUsageIcon",
        "sidebarSecurityOptUsageText"
      ]
    },
    {
      "id": "sidebarSecurityOptUsageIcon",
      "component": "Icon",
      "props": {
        "name": "file-text",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "sidebarSecurityOptUsageText",
      "component": "span",
      "props": {
        "value": "使用声明",
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "mainContentArea",
      "component": "main",
      "props": {
        "className": "flex-1 overflow-y-auto bg-surface-bright px-[100px] py-8"
      },
      "children": [
        "mainInner"
      ]
    },
    {
      "id": "mainInner",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-8"
      },
      "children": [
        "mainPageTitle",
        "mainSystemProviderSection",
        "mainCustomProviderSection",
        "mainRichCardSection",
        "mainReactPanelsSection",
        "mainDashboardSection"
      ]
    },
    {
      "id": "mainPageTitle",
      "component": "h1",
      "props": {
        "value": {
          "path": "/pageTitle"
        },
        "className": "text-2xl font-semibold text-on-surface"
      }
    },
    {
      "id": "mainSystemProviderSection",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-3"
      },
      "children": [
        "mainSystemProviderTitle",
        "mainSystemProviderCard"
      ]
    },
    {
      "id": "mainSystemProviderTitle",
      "component": "span",
      "props": {
        "value": "系统提供商",
        "className": "text-lg font-semibold text-on-surface"
      }
    },
    {
      "id": "mainSystemProviderCard",
      "component": "div",
      "props": {
        "className": "w-full bg-surface-variant rounded-xl p-4 flex items-center gap-4"
      },
      "children": [
        "mainSysLogo",
        "mainSysInfo"
      ]
    },
    {
      "id": "mainSysLogo",
      "component": "div",
      "props": {
        "className": "w-[50px] h-[50px] shrink-0 rounded-md bg-surface-container-highest border border-outline-variant flex items-center justify-center"
      },
      "children": [
        "mainSysLogoIcon"
      ]
    },
    {
      "id": "mainSysLogoIcon",
      "component": "Icon",
      "props": {
        "name": "hexagon",
        "color": "brand",
        "className": "w-6 h-6"
      }
    },
    {
      "id": "mainSysInfo",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-1"
      },
      "children": [
        "mainSysName",
        "mainSysDetails"
      ]
    },
    {
      "id": "mainSysName",
      "component": "span",
      "props": {
        "value": {
          "path": "/systemProvider/name"
        },
        "className": "text-md font-medium text-on-surface"
      }
    },
    {
      "id": "mainSysDetails",
      "component": "div",
      "props": {
        "className": "flex items-center gap-4"
      },
      "children": [
        "mainSysModelPair",
        "mainSysUrlPair"
      ]
    },
    {
      "id": "mainSysModelPair",
      "component": "div",
      "props": {
        "className": "flex items-center gap-1"
      },
      "children": [
        "mainSysModelLabel",
        "mainSysModelValue"
      ]
    },
    {
      "id": "mainSysModelLabel",
      "component": "span",
      "props": {
        "value": "Model",
        "className": "text-sm text-on-surface-variant"
      }
    },
    {
      "id": "mainSysModelValue",
      "component": "span",
      "props": {
        "value": {
          "path": "/systemProvider/modelCount"
        },
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "mainSysUrlPair",
      "component": "div",
      "props": {
        "className": "flex items-center gap-1"
      },
      "children": [
        "mainSysUrlLabel",
        "mainSysUrlValue"
      ]
    },
    {
      "id": "mainSysUrlLabel",
      "component": "span",
      "props": {
        "value": "Base URL",
        "className": "text-sm text-on-surface-variant"
      }
    },
    {
      "id": "mainSysUrlValue",
      "component": "span",
      "props": {
        "value": {
          "path": "/systemProvider/baseUrl"
        },
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "mainCustomProviderSection",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-3"
      },
      "children": [
        "mainCustomProviderHeader",
        "mainCustomProviderCard"
      ]
    },
    {
      "id": "mainCustomProviderHeader",
      "component": "div",
      "props": {
        "className": "flex items-center justify-between"
      },
      "children": [
        "mainCustomProviderTitle",
        "mainCustomProviderActions"
      ]
    },
    {
      "id": "mainCustomProviderTitle",
      "component": "span",
      "props": {
        "value": "自定义提供商",
        "className": "text-lg font-semibold text-on-surface"
      }
    },
    {
      "id": "mainCustomProviderActions",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2"
      },
      "children": [
        "mainCustomProviderSearch",
        "mainCustomProviderBtnDefault",
        "mainCustomProviderBtnProxy",
        "mainCustomProviderBtnAdd"
      ]
    },
    {
      "id": "mainCustomProviderSearch",
      "component": "Input",
      "props": {
        "value": {
          "path": "/searchValue"
        },
        "placeholder": "搜索提供商名称",
        "prefix": "search",
        "size": "small",
        "className": "w-56"
      }
    },
    {
      "id": "mainCustomProviderBtnDefault",
      "component": "Button",
      "props": {
        "value": "默认LMM",
        "icon": "bot",
        "iconPlacement": "start",
        "size": "small"
      }
    },
    {
      "id": "mainCustomProviderBtnProxy",
      "component": "Button",
      "props": {
        "value": "代理配置",
        "icon": "network",
        "iconPlacement": "start",
        "size": "small"
      }
    },
    {
      "id": "mainCustomProviderBtnAdd",
      "component": "Button",
      "props": {
        "value": "增加",
        "icon": "plus",
        "iconPlacement": "start",
        "color": "primary",
        "size": "small"
      }
    },
    {
      "id": "mainCustomProviderCard",
      "component": "div",
      "props": {
        "className": "w-full bg-surface-variant rounded-xl overflow-hidden"
      },
      "children": [
        "mainCustomProviderList"
      ]
    },
    {
      "id": "mainCustomProviderList",
      "component": "div",
      "props": {
        "className": "divide-y divide-outline-variant"
      },
      "children": {
        "path": "/customProviders",
        "componentId": "mainCustomProviderItem"
      }
    },
    {
      "id": "mainCustomProviderItem",
      "component": "div",
      "props": {
        "className": "px-4 py-3 flex items-center justify-between"
      },
      "children": [
        "mainCustomProviderItemLeft",
        "mainCustomProviderItemRight"
      ]
    },
    {
      "id": "mainCustomProviderItemLeft",
      "component": "div",
      "props": {
        "className": "flex items-center gap-4 min-w-0"
      },
      "children": [
        "mainCustomProviderItemLogo",
        "mainCustomProviderItemInfo"
      ]
    },
    {
      "id": "mainCustomProviderItemLogo",
      "component": "div",
      "props": {
        "className": "w-[50px] h-[50px] shrink-0 rounded-md bg-surface-container-highest border border-outline-variant flex items-center justify-center"
      },
      "children": [
        "mainCustomProviderItemLogoIcon"
      ]
    },
    {
      "id": "mainCustomProviderItemLogoIcon",
      "component": "Icon",
      "props": {
        "name": {
          "path": "logoIcon"
        },
        "color": {
          "path": "logoColor"
        },
        "className": "w-6 h-6"
      }
    },
    {
      "id": "mainCustomProviderItemInfo",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-1 min-w-0"
      },
      "children": [
        "mainCustomProviderItemName",
        "mainCustomProviderItemDetails"
      ]
    },
    {
      "id": "mainCustomProviderItemName",
      "component": "span",
      "props": {
        "value": {
          "path": "providerName"
        },
        "className": "text-md font-medium text-on-surface"
      }
    },
    {
      "id": "mainCustomProviderItemDetails",
      "component": "div",
      "props": {
        "className": "flex items-center gap-4"
      },
      "children": [
        "mainCustomProviderItemModelPair",
        "mainCustomProviderItemUrlPair"
      ]
    },
    {
      "id": "mainCustomProviderItemModelPair",
      "component": "div",
      "props": {
        "className": "flex items-center gap-1"
      },
      "children": [
        "mainCustomProviderItemModelLabel",
        "mainCustomProviderItemModelValue"
      ]
    },
    {
      "id": "mainCustomProviderItemModelLabel",
      "component": "span",
      "props": {
        "value": "Model",
        "className": "text-sm text-on-surface-variant"
      }
    },
    {
      "id": "mainCustomProviderItemModelValue",
      "component": "span",
      "props": {
        "value": {
          "path": "modelCount"
        },
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "mainCustomProviderItemUrlPair",
      "component": "div",
      "props": {
        "className": "flex items-center gap-1"
      },
      "children": [
        "mainCustomProviderItemUrlLabel",
        "mainCustomProviderItemUrlValue"
      ]
    },
    {
      "id": "mainCustomProviderItemUrlLabel",
      "component": "span",
      "props": {
        "value": "Base URL",
        "className": "text-sm text-on-surface-variant"
      }
    },
    {
      "id": "mainCustomProviderItemUrlValue",
      "component": "span",
      "props": {
        "value": {
          "path": "baseUrl"
        },
        "className": "text-sm text-on-surface"
      }
    },
    {
      "id": "mainCustomProviderItemRight",
      "component": "div",
      "props": {
        "className": "flex items-center gap-2 shrink-0"
      },
      "children": [
        "mainCustomProviderItemSettingsIcon",
        "mainCustomProviderItemDeleteIcon"
      ]
    },
    {
      "id": "mainCustomProviderItemSettingsIcon",
      "component": "Icon",
      "props": {
        "name": "settings",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "mainCustomProviderItemDeleteIcon",
      "component": "Icon",
      "props": {
        "name": "trash-2",
        "className": "w-4 h-4"
      }
    },
    {
      "id": "mainRichCardSection",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-3"
      },
      "children": [
        "mainRichCardTitle",
        "mainRichCard"
      ]
    },
    {
      "id": "mainRichCardTitle",
      "component": "span",
      "props": {
        "value": "推荐模型卡片",
        "className": "text-lg font-semibold text-on-surface"
      }
    },
    {
      "id": "mainRichCard",
      "component": "RichCard"
    },
    {
      "id": "mainReactPanelsSection",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-3"
      },
      "children": [
        "mainReactPanelsTitle",
        "mainReactPanelsRow"
      ]
    },
    {
      "id": "mainReactPanelsTitle",
      "component": "span",
      "props": {
        "value": "实时面板",
        "className": "text-lg font-semibold text-on-surface"
      }
    },
    {
      "id": "mainReactPanelsRow",
      "component": "div",
      "props": {
        "className": "flex flex-wrap items-start gap-6"
      },
      "children": [
        "mainStatPanel",
        "mainTodoList"
      ]
    },
    {
      "id": "mainStatPanel",
      "component": "StatPanel"
    },
    {
      "id": "mainTodoList",
      "component": "TodoList"
    },
    {
      "id": "mainDashboardSection",
      "component": "div",
      "props": {
        "className": "flex flex-col gap-3"
      },
      "children": [
        "mainDashboardTitle",
        "mainDashboard"
      ]
    },
    {
      "id": "mainDashboardTitle",
      "component": "span",
      "props": {
        "value": "服务监控面板",
        "className": "text-lg font-semibold text-on-surface"
      }
    },
    {
      "id": "mainDashboard",
      "component": "Dashboard"
    }
  ]
};
