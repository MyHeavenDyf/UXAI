<<<<<<< HEAD
window.__A2UI_DATA__ = {"rootId":"loginPageRoot","elements":[{"id":"loginPageRoot","component":"div","props":{"className":"relative flex flex-col min-h-screen w-screen overflow-hidden bg-surface-container-lowest"},"children":["loginBrandBg","loginCardCenter","loginFooter"]},{"id":"loginBrandBg","component":"div","props":{"className":"absolute inset-0 z-0 overflow-hidden"},"children":["bgBackgroundImg","bgOverlay","bgBrandContainer"]},{"id":"loginCardCenter","component":"div","props":{"className":"relative z-10 flex-1 flex items-center justify-center px-4"},"children":["cardLoginCard"]},{"id":"loginFooter","component":"div","props":{"className":"relative z-10 w-full text-center py-4 text-sm text-on-surface-variant"},"children":["ftrCopyrightText","ftrDivider","ftrIcpText"]},{"id":"bgBackgroundImg","component":"img","props":{"className":"absolute inset-0 w-full h-full object-cover","src":{"path":"/bgBackgroundImage"},"alt":"品牌背景"}},{"id":"bgOverlay","component":"div","props":{"className":"absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/60"}},{"id":"bgBrandContainer","component":"div","props":{"className":"absolute top-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 z-10"},"children":["bgLogoIcon","bgProductName","bgSlogan"]},{"id":"bgLogoIcon","component":"Icon","props":{"name":{"path":"/brand/logoIcon"},"color":"inverse","shape":"square","className":"w-12 h-12"}},{"id":"bgProductName","component":"span","props":{"className":"text-3xl font-bold text-white tracking-wide","value":{"path":"/brand/productName"}}},{"id":"bgSlogan","component":"span","props":{"className":"text-lg text-white/80 tracking-wider","value":{"path":"/brand/slogan"}}},{"id":"cardLoginCard","component":"div","props":{"className":"w-full max-w-[420px] bg-surface-container-highest rounded-xl shadow-card p-inset flex flex-col gap-stack"},"children":["cardBrandHeader","cardUsernameInput","cardPasswordInput","cardCaptchaArea","cardActionsRow","cardErrorDisplay","cardLoginBtn","cardSecurityInfo","cardRegisterRow"]},{"id":"cardBrandHeader","component":"div","props":{"className":"flex flex-col items-center gap-2 pb-3 border-b border-divider"},"children":["cardBrandIcon","cardWelcomeTitle","cardProductName","cardSlogan"]},{"id":"cardBrandIcon","component":"Icon","props":{"name":"cloud","color":"primary","shape":"square","className":"w-10 h-10"}},{"id":"cardWelcomeTitle","component":"span","props":{"className":"text-2xl font-bold text-on-surface","value":"欢迎登录"}},{"id":"cardProductName","component":"span","props":{"className":"text-md text-on-surface-variant","value":"A2 Cloud Console"}},{"id":"cardSlogan","component":"span","props":{"className":"text-sm text-on-surface-variant","value":"企业级云管理平台"}},{"id":"cardUsernameInput","component":"Input","props":{"value":{"path":"/username"},"placeholder":"请输入用户名","prefix":"user","size":"large","className":"w-full"}},{"id":"cardPasswordInput","component":"Input","props":{"value":{"path":"/password"},"placeholder":"请输入密码","prefix":"lock","password":true,"size":"large","className":"w-full"}},{"id":"cardCaptchaArea","component":"div","props":{"className":"flex flex-col gap-2"},"children":["cardCaptchaType","cardCaptchaCodeRow","cardCaptchaInput"]},{"id":"cardCaptchaType","component":"Segmented","props":{"value":{"path":"/captchaType"},"options":[{"label":"图形验证码","value":"图形验证码"},{"label":"短信验证码","value":"短信验证码"}],"block":true,"size":"small","className":"w-full"}},{"id":"cardCaptchaCodeRow","component":"div","props":{"className":"flex items-center gap-3"},"children":["cardCaptchaImage","cardSmsCaptchaBtn"]},{"id":"cardCaptchaImage","component":"img","props":{"src":"/image.jpg","alt":"图形验证码","className":"h-10 w-auto rounded-md border border-base cursor-pointer"}},{"id":"cardSmsCaptchaBtn","component":"Button","props":{"value":"获取验证码","color":"primary","size":"medium","className":"flex-shrink-0"}},{"id":"cardCaptchaInput","component":"Input","props":{"value":{"path":"/captchaValue"},"placeholder":"请输入验证码","size":"large","className":"w-full"}},{"id":"cardActionsRow","component":"div","props":{"className":"flex items-center justify-between"},"children":["cardRememberCheckbox","cardForgotLink"]},{"id":"cardRememberCheckbox","component":"Checkbox","props":{"checked":{"path":"/rememberMe"},"label":"记住密码"}},{"id":"cardForgotLink","component":"Button","props":{"value":"忘记密码","types":"link","color":"primary"}},{"id":"cardErrorDisplay","component":"div","props":{"className":"flex items-center gap-2 p-2 bg-error-container rounded-lg"},"children":["cardErrorIcon","cardErrorMessage"]},{"id":"cardErrorIcon","component":"Icon","props":{"name":"circle-alert","color":"error","shape":"outline","className":"w-4 h-4"}},{"id":"cardErrorMessage","component":"span","props":{"className":"text-sm text-on-error-container","value":{"path":"/errorMessage"}}},{"id":"cardLoginBtn","component":"Button","props":{"value":"登 录","color":"primary","size":"large","className":"w-full"}},{"id":"cardSecurityInfo","component":"div","props":{"className":"flex items-start gap-2 p-2 bg-warning-container rounded-lg"},"children":["cardSecurityIcon","cardSecurityText"]},{"id":"cardSecurityIcon","component":"Icon","props":{"name":"shield-alert","color":"warning","shape":"outline","className":"w-4 h-4 mt-0.5"}},{"id":"cardSecurityText","component":"span","props":{"className":"text-xs text-on-warning-container","value":{"path":"/lastFailedLoginInfo"}}},{"id":"cardRegisterRow","component":"div","props":{"className":"text-center"},"children":["cardRegisterLink"]},{"id":"cardRegisterLink","component":"Button","props":{"value":"还没有账号？立即注册","types":"link","color":"primary"}},{"id":"ftrCopyrightText","component":"span","props":{"value":"© 2026 A2 Cloud Technology Co., Ltd. All rights reserved."}},{"id":"ftrDivider","component":"span","props":{"value":" | "}},{"id":"ftrIcpText","component":"span","props":{"value":"京ICP备2026xxxx号-1"}}],"state":{"bgBackgroundImage":"/background.jpg","brand":{"logoIcon":"Cloud","productName":"A2 Cloud Console","slogan":"企业级云管理平台"},"username":"","password":"","rememberMe":true,"captchaType":"图形验证码","captchaValue":"","loading":false,"errorMessage":null,"lastFailedLoginInfo":"上次登录失败：2026-07-20 23:15:32 (IP: 192.168.1.105)"}};
=======
window.__A2UI_DATA__ = {
    "state": {
        "ghPlatformName": "iMaster NCE-FabricInsight",
        "ghLeftNav": [
            {
                "label": "健康看板",
                "icon": "activity",
                "link": "/health"
            },
            {
                "label": "大屏",
                "icon": "monitor",
                "link": "/dashboard"
            }
        ],
        "ghRightNav": [
            {
                "label": "策略中心",
                "icon": "shield-check",
                "link": "/policy"
            }
        ],
        "ghSystemActions": [
            {
                "icon": "search",
                "tooltip": "搜索"
            },
            {
                "icon": "bell",
                "tooltip": "通知"
            },
            {
                "icon": "settings",
                "tooltip": "设置"
            },
            {
                "icon": "help-circle",
                "tooltip": "帮助"
            }
        ],
        "ghUserInfo": {
            "userName": "Admin",
            "avatarImage": "https://randomuser.me/api/portraits/men/32.jpg"
        },
        "lrlCardTitle": "链路结果",
        "lrlSearchCategory": "请选择",
        "lrlSearchValue": "",
        "lrlSelectedRowKeys": [
            1
        ],
        "lrlTableData": [
            {
                "id": 1,
                "peerCrc": "未检测",
                "localAlarm": "光模块IIC故障",
                "peerAlarm": "无",
                "temp": "41.40°C",
                "voltage": "3.35V",
                "txPowerLocal": "Lane1:-1dBm...",
                "rxPowerLocal": "Lane0:2.43dBm...",
                "currentLocal": "Lane0:87.23mA...",
                "snrLocal": "Lane0:1dB...",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.95dBm..."
            },
            {
                "id": 2,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "38.50°C",
                "voltage": "3.32V",
                "txPowerLocal": "Lane1:-1.2dBm",
                "rxPowerLocal": "Lane0:2.10dBm",
                "currentLocal": "Lane0:82.15mA",
                "snrLocal": "Lane0:2dB",
                "berLocal": "1e-12",
                "txPowerPeer": "Lane0:-1.05dBm"
            },
            {
                "id": 3,
                "peerCrc": "12",
                "localAlarm": "接收功率低",
                "peerAlarm": "无",
                "temp": "45.10°C",
                "voltage": "3.30V",
                "txPowerLocal": "Lane1:-0.8dBm",
                "rxPowerLocal": "Lane0:-5.43dBm",
                "currentLocal": "Lane0:90.12mA",
                "snrLocal": "Lane0:0.5dB",
                "berLocal": "1e-5",
                "txPowerPeer": "Lane0:-0.85dBm"
            },
            {
                "id": 4,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "40.20°C",
                "voltage": "3.34V",
                "txPowerLocal": "Lane1:-1.1dBm",
                "rxPowerLocal": "Lane0:2.30dBm",
                "currentLocal": "Lane0:85.40mA",
                "snrLocal": "Lane0:1.5dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.90dBm"
            },
            {
                "id": 5,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "39.80°C",
                "voltage": "3.33V",
                "txPowerLocal": "Lane1:-1.0dBm",
                "rxPowerLocal": "Lane0:2.25dBm",
                "currentLocal": "Lane0:84.20mA",
                "snrLocal": "Lane0:1.2dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.98dBm"
            },
            {
                "id": 6,
                "peerCrc": "5",
                "localAlarm": "无",
                "peerAlarm": "发送功率高",
                "temp": "42.60°C",
                "voltage": "3.36V",
                "txPowerLocal": "Lane1:1.5dBm",
                "rxPowerLocal": "Lane0:2.50dBm",
                "currentLocal": "Lane0:88.10mA",
                "snrLocal": "Lane0:1.1dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:2.10dBm"
            },
            {
                "id": 7,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "41.00°C",
                "voltage": "3.35V",
                "txPowerLocal": "Lane1:-1.0dBm",
                "rxPowerLocal": "Lane0:2.40dBm",
                "currentLocal": "Lane0:86.50mA",
                "snrLocal": "Lane0:1.0dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.92dBm"
            },
            {
                "id": 8,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "37.90°C",
                "voltage": "3.31V",
                "txPowerLocal": "Lane1:-1.3dBm",
                "rxPowerLocal": "Lane0:2.05dBm",
                "currentLocal": "Lane1:81.40mA",
                "snrLocal": "Lane0:2.1dB",
                "berLocal": "1e-13",
                "txPowerPeer": "Lane0:-1.10dBm"
            },
            {
                "id": 9,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "40.50°C",
                "voltage": "3.34V",
                "txPowerLocal": "Lane1:-1.1dBm",
                "rxPowerLocal": "Lane0:2.35dBm",
                "currentLocal": "Lane0:85.90mA",
                "snrLocal": "Lane0:1.4dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.94dBm"
            },
            {
                "id": 10,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "39.20°C",
                "voltage": "3.33V",
                "txPowerLocal": "Lane1:-1.2dBm",
                "rxPowerLocal": "Lane0:2.15dBm",
                "currentLocal": "Lane0:83.10mA",
                "snrLocal": "Lane0:1.8dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-1.02dBm"
            },
            {
                "id": 11,
                "peerCrc": "2",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "43.00°C",
                "voltage": "3.37V",
                "txPowerLocal": "Lane1:-0.9dBm",
                "rxPowerLocal": "Lane0:2.60dBm",
                "currentLocal": "Lane0:89.50mA",
                "snrLocal": "Lane0:0.9dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.80dBm"
            },
            {
                "id": 12,
                "peerCrc": "0",
                "localAlarm": "无",
                "peerAlarm": "无",
                "temp": "41.20°C",
                "voltage": "3.35V",
                "txPowerLocal": "Lane1:-1.0dBm",
                "rxPowerLocal": "Lane0:2.42dBm",
                "currentLocal": "Lane0:87.00mA",
                "snrLocal": "Lane0:1.1dB",
                "berLocal": "NA",
                "txPowerPeer": "Lane0:-0.93dBm"
            }
        ],
        "mddDrawerTitle": "指标详情",
        "mddTimeRange": "2025/05/15 00:54:12 - 2025/05/15 14:54:12",
        "mddActiveTab": "local",
        "mddTabs": [
            {
                "key": "local",
                "label": "本端"
            },
            {
                "key": "peer",
                "label": "对端"
            }
        ],
        "mddBaseInfo": {
            "deviceName": "POD7-spine1",
            "devicePort": "25GE1/0/4",
            "aggregationMethod": "平均值"
        },
        "mddAggregationOptions": [
            {
                "label": "平均值",
                "value": "平均值"
            },
            {
                "label": "最大值",
                "value": "最大值"
            },
            {
                "label": "最小值",
                "value": "最小值"
            }
        ],
        "mddMetrics": [
            {
                "chartTitle": "接收功率",
                "unit": "dBm",
                "kpis": [
                    {
                        "label": "最大值",
                        "value": "-1.74 dBm"
                    },
                    {
                        "label": "最小值",
                        "value": "-1.74 dBm"
                    },
                    {
                        "label": "平均值",
                        "value": "-1.74 dBm"
                    }
                ],
                "chartData": [
                    {
                        "timestamp": "00:54",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "01:49",
                        "lane0": 86.9,
                        "lane1": 84.8,
                        "lane2": 86.1,
                        "lane3": 84.6
                    },
                    {
                        "timestamp": "02:43",
                        "lane0": 87.1,
                        "lane1": 85.0,
                        "lane2": 86.3,
                        "lane3": 84.8
                    },
                    {
                        "timestamp": "03:38",
                        "lane0": 86.7,
                        "lane1": 84.6,
                        "lane2": 85.9,
                        "lane3": 84.4
                    },
                    {
                        "timestamp": "04:32",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "05:27",
                        "lane0": 87.5,
                        "lane1": 85.4,
                        "lane2": 86.7,
                        "lane3": 85.2
                    },
                    {
                        "timestamp": "06:22",
                        "lane0": 86.8,
                        "lane1": 84.7,
                        "lane2": 86.0,
                        "lane3": 84.5
                    },
                    {
                        "timestamp": "07:17",
                        "lane0": 87.0,
                        "lane1": 84.9,
                        "lane2": 86.2,
                        "lane3": 84.7
                    },
                    {
                        "timestamp": "08:12",
                        "lane0": 86.6,
                        "lane1": 84.5,
                        "lane2": 85.8,
                        "lane3": 84.3
                    },
                    {
                        "timestamp": "09:07",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    }
                ]
            },
            {
                "chartTitle": "发送功率",
                "unit": "dBm",
                "kpis": [
                    {
                        "label": "最大值",
                        "value": "2.43 dBm"
                    },
                    {
                        "label": "最小值",
                        "value": "2.40 dBm"
                    },
                    {
                        "label": "平均值",
                        "value": "2.42 dBm"
                    }
                ],
                "chartData": [
                    {
                        "timestamp": "00:54",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "01:49",
                        "lane0": 86.9,
                        "lane1": 84.8,
                        "lane2": 86.1,
                        "lane3": 84.6
                    },
                    {
                        "timestamp": "02:43",
                        "lane0": 87.1,
                        "lane1": 85.0,
                        "lane2": 86.3,
                        "lane3": 84.8
                    },
                    {
                        "timestamp": "03:38",
                        "lane0": 86.7,
                        "lane1": 84.6,
                        "lane2": 85.9,
                        "lane3": 84.4
                    },
                    {
                        "timestamp": "04:32",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "05:27",
                        "lane0": 87.5,
                        "lane1": 85.4,
                        "lane2": 86.7,
                        "lane3": 85.2
                    },
                    {
                        "timestamp": "06:22",
                        "lane0": 86.8,
                        "lane1": 84.7,
                        "lane2": 86.0,
                        "lane3": 84.5
                    },
                    {
                        "timestamp": "07:17",
                        "lane0": 87.0,
                        "lane1": 84.9,
                        "lane2": 86.2,
                        "lane3": 84.7
                    },
                    {
                        "timestamp": "08:12",
                        "lane0": 86.6,
                        "lane1": 84.5,
                        "lane2": 85.8,
                        "lane3": 84.3
                    },
                    {
                        "timestamp": "09:07",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    }
                ]
            },
            {
                "chartTitle": "电流",
                "unit": "mA",
                "kpis": [
                    {
                        "label": "最大值",
                        "value": "87.23 mA"
                    },
                    {
                        "label": "最小值",
                        "value": "86.50 mA"
                    },
                    {
                        "label": "平均值",
                        "value": "86.85 mA"
                    }
                ],
                "chartData": [
                    {
                        "timestamp": "00:54",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "01:49",
                        "lane0": 86.9,
                        "lane1": 84.8,
                        "lane2": 86.1,
                        "lane3": 84.6
                    },
                    {
                        "timestamp": "02:43",
                        "lane0": 87.1,
                        "lane1": 85.0,
                        "lane2": 86.3,
                        "lane3": 84.8
                    },
                    {
                        "timestamp": "03:38",
                        "lane0": 86.7,
                        "lane1": 84.6,
                        "lane2": 85.9,
                        "lane3": 84.4
                    },
                    {
                        "timestamp": "04:32",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    },
                    {
                        "timestamp": "05:27",
                        "lane0": 87.5,
                        "lane1": 85.4,
                        "lane2": 86.7,
                        "lane3": 85.2
                    },
                    {
                        "timestamp": "06:22",
                        "lane0": 86.8,
                        "lane1": 84.7,
                        "lane2": 86.0,
                        "lane3": 84.5
                    },
                    {
                        "timestamp": "07:17",
                        "lane0": 87.0,
                        "lane1": 84.9,
                        "lane2": 86.2,
                        "lane3": 84.7
                    },
                    {
                        "timestamp": "08:12",
                        "lane0": 86.6,
                        "lane1": 84.5,
                        "lane2": 85.8,
                        "lane3": 84.3
                    },
                    {
                        "timestamp": "09:07",
                        "lane0": 87.23,
                        "lane1": 85.1,
                        "lane2": 86.4,
                        "lane3": 84.9
                    }
                ]
            }
        ]
    },
    "rootId": "rootContainer",
    "elements": [
        {
            "id": "rootContainer",
            "component": "div",
            "props": {
                "className": "flex flex-col h-screen w-full bg-surface-container-lowest overflow-hidden"
            },
            "children": [
                "shellHeader",
                "shellMain"
            ]
        },
        {
            "id": "shellHeader",
            "component": "header",
            "props": {
                "className": "h-12 w-full bg-surface-container-highest shadow-sm z-20 flex items-center justify-between px-gutter"
            },
            "children": [
                "ghLeftSection",
                "ghRightSection"
            ]
        },
        {
            "id": "shellMain",
            "component": "main",
            "props": {
                "className": "flex flex-1 relative overflow-hidden"
            },
            "children": [
                "shellContentScroll",
                "shellDrawerOverlay"
            ]
        },
        {
            "id": "shellContentScroll",
            "component": "section",
            "props": {
                "className": "flex-1 overflow-auto p-page bg-surface-container-lowest"
            },
            "children": [
                "lrlMainContainer"
            ]
        },
        {
            "id": "shellDrawerOverlay",
            "component": "aside",
            "props": {
                "className": "absolute right-0 top-0 h-full w-[480px] bg-surface-container-highest shadow-lg z-10 border-l border-divider flex flex-col"
            },
            "children": [
                "mddHeader",
                "mddTabsContainer",
                "mddScrollContent"
            ]
        },
        {
            "id": "ghLeftSection",
            "component": "div",
            "props": {
                "className": "flex items-center gap-4 h-full"
            },
            "children": [
                "ghCollapseBtn",
                "ghBrandContainer",
                "ghLeftNavLinks"
            ]
        },
        {
            "id": "ghCollapseBtn",
            "component": "Button",
            "props": {
                "icon": "menu",
                "types": "link",
                "className": "text-on-surface"
            }
        },
        {
            "id": "ghBrandContainer",
            "component": "div",
            "props": {
                "className": "flex items-center mr-4"
            },
            "children": [
                "ghPlatformTitle"
            ]
        },
        {
            "id": "ghPlatformTitle",
            "component": "span",
            "props": {
                "value": {
                    "path": "/ghPlatformName"
                },
                "className": "text-lg font-bold text-primary"
            }
        },
        {
            "id": "ghLeftNavLinks",
            "component": "div",
            "props": {
                "className": "flex items-center gap-2"
            },
            "children": {
                "path": "/ghLeftNav",
                "componentId": "ghLeftNavItem"
            }
        },
        {
            "id": "ghLeftNavItem",
            "component": "Button",
            "props": {
                "value": {
                    "path": "label"
                },
                "icon": {
                    "path": "icon"
                },
                "types": "link",
                "className": "text-on-surface-variant hover:text-primary"
            }
        },
        {
            "id": "ghRightSection",
            "component": "div",
            "props": {
                "className": "flex items-center gap-4 h-full"
            },
            "children": [
                "ghRightNavLinks",
                "ghActionIcons",
                "ghUserContainer"
            ]
        },
        {
            "id": "ghRightNavLinks",
            "component": "div",
            "props": {
                "className": "flex items-center border-r border-divider pr-4"
            },
            "children": {
                "path": "/ghRightNav",
                "componentId": "ghRightNavItem"
            }
        },
        {
            "id": "ghRightNavItem",
            "component": "Button",
            "props": {
                "value": {
                    "path": "label"
                },
                "icon": {
                    "path": "icon"
                },
                "types": "link",
                "className": "text-on-surface-variant hover:text-primary"
            }
        },
        {
            "id": "ghActionIcons",
            "component": "div",
            "props": {
                "className": "flex items-center gap-1"
            },
            "children": {
                "path": "/ghSystemActions",
                "componentId": "ghActionIconBtn"
            }
        },
        {
            "id": "ghActionIconBtn",
            "component": "Button",
            "props": {
                "icon": {
                    "path": "icon"
                },
                "types": "link",
                "className": "text-on-surface-variant hover:bg-surface-variant rounded-full"
            }
        },
        {
            "id": "ghUserContainer",
            "component": "div",
            "props": {
                "className": "flex items-center gap-2 pl-2 cursor-pointer"
            },
            "children": [
                "ghUserAvatar",
                "ghUserName"
            ]
        },
        {
            "id": "ghUserAvatar",
            "component": "img",
            "props": {
                "src": {
                    "path": "/ghUserInfo/avatarImage"
                },
                "className": "w-8 h-8 rounded-full border border-divider"
            }
        },
        {
            "id": "ghUserName",
            "component": "span",
            "props": {
                "value": {
                    "path": "/ghUserInfo/userName"
                },
                "className": "text-md font-medium text-on-surface"
            }
        },
        {
            "id": "lrlMainContainer",
            "component": "div",
            "props": {
                "className": "flex flex-col gap-section bg-surface-container-highest rounded-container shadow-card p-inset"
            },
            "children": [
                "lrlHeaderArea",
                "lrlSearchArea",
                "lrlTableArea"
            ]
        },
        {
            "id": "lrlHeaderArea",
            "component": "div",
            "props": {
                "className": "flex items-center justify-between"
            },
            "children": [
                "lrlTitle"
            ]
        },
        {
            "id": "lrlTitle",
            "component": "span",
            "props": {
                "value": {
                    "path": "/lrlCardTitle"
                },
                "className": "text-lg font-bold text-on-surface"
            }
        },
        {
            "id": "lrlSearchArea",
            "component": "div",
            "props": {
                "className": "flex items-center gap-inline"
            },
            "children": [
                "lrlSearchSelect",
                "lrlSearchInput"
            ]
        },
        {
            "id": "lrlSearchSelect",
            "component": "Select",
            "props": {
                "value": {
                    "path": "/lrlSearchCategory"
                },
                "placeholder": "请选择",
                "options": [
                    {
                        "label": "全部",
                        "value": "all"
                    },
                    {
                        "label": "本端告警",
                        "value": "local"
                    },
                    {
                        "label": "对端告警",
                        "value": "peer"
                    }
                ],
                "className": "w-40"
            }
        },
        {
            "id": "lrlSearchInput",
            "component": "Input",
            "props": {
                "value": {
                    "path": "/lrlSearchValue"
                },
                "placeholder": "请输入搜索内容",
                "prefix": "search",
                "className": "w-64"
            }
        },
        {
            "id": "lrlTableArea",
            "component": "Table",
            "props": {
                "rowKey": "id",
                "dataSource": {
                    "path": "/lrlTableData"
                },
                "rowSelection": {
                    "type": "checkbox",
                    "selectedRowKeys": {
                        "path": "/lrlSelectedRowKeys"
                    }
                },
                "columns": [
                    {
                        "title": "对端端口crc(近一天)",
                        "dataIndex": "peerCrc"
                    },
                    {
                        "title": "本端光模块告警(近一天)",
                        "dataIndex": "localAlarm",
                        "minWidth": 160
                    },
                    {
                        "title": "对端告警(近一天)",
                        "dataIndex": "peerAlarm",
                        "minWidth": 140
                    },
                    {
                        "title": "温度",
                        "dataIndex": "temp"
                    },
                    {
                        "title": "电压",
                        "dataIndex": "voltage"
                    },
                    {
                        "title": "发送功率(本端)",
                        "dataIndex": "txPowerLocal",
                        "minWidth": 140
                    },
                    {
                        "title": "接收功率(本端)",
                        "dataIndex": "rxPowerLocal",
                        "minWidth": 140
                    },
                    {
                        "title": "电流(本端)",
                        "dataIndex": "currentLocal",
                        "minWidth": 140
                    },
                    {
                        "title": "信噪比(本端)",
                        "dataIndex": "snrLocal"
                    },
                    {
                        "title": "误码率(本端)",
                        "dataIndex": "berLocal"
                    },
                    {
                        "title": "发送功率(对端)",
                        "dataIndex": "txPowerPeer",
                        "minWidth": 140
                    },
                    {
                        "title": "操作",
                        "dataIndex": "actions",
                        "fixed": "end",
                        "width": 100
                    }
                ],
                "className": "mb-stack"
            },
            "children": {
                "path": "/lrlTableData",
                "componentId": "lrlTableRow"
            }
        },
        {
            "id": "lrlTableRow",
            "component": "TableRow",
            "children": [
                "lrlCellPeerCrc",
                "lrlCellLocalAlarm",
                "lrlCellPeerAlarm",
                "lrlCellTemp",
                "lrlCellVoltage",
                "lrlCellTxLocal",
                "lrlCellRxLocal",
                "lrlCellCurrentLocal",
                "lrlCellSnrLocal",
                "lrlCellBerLocal",
                "lrlCellTxPeer",
                "lrlCellActions"
            ]
        },
        {
            "id": "lrlCellPeerCrc",
            "component": "span",
            "props": {
                "value": {
                    "path": "peerCrc"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellLocalAlarm",
            "component": "Tag",
            "props": {
                "value": {
                    "path": "localAlarm"
                },
                "color": "error",
                "variant": "outlined"
            }
        },
        {
            "id": "lrlCellPeerAlarm",
            "component": "span",
            "props": {
                "value": {
                    "path": "peerAlarm"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellTemp",
            "component": "span",
            "props": {
                "value": {
                    "path": "temp"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellVoltage",
            "component": "span",
            "props": {
                "value": {
                    "path": "voltage"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellTxLocal",
            "component": "span",
            "props": {
                "value": {
                    "path": "txPowerLocal"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellRxLocal",
            "component": "span",
            "props": {
                "value": {
                    "path": "rxPowerLocal"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellCurrentLocal",
            "component": "span",
            "props": {
                "value": {
                    "path": "currentLocal"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellSnrLocal",
            "component": "span",
            "props": {
                "value": {
                    "path": "snrLocal"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellBerLocal",
            "component": "span",
            "props": {
                "value": {
                    "path": "berLocal"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellTxPeer",
            "component": "span",
            "props": {
                "value": {
                    "path": "txPowerPeer"
                },
                "className": "text-md text-on-surface"
            }
        },
        {
            "id": "lrlCellActions",
            "component": "div",
            "props": {
                "className": "flex items-center gap-inline"
            },
            "children": [
                "lrlActionChart",
                "lrlActionSettings"
            ]
        },
        {
            "id": "lrlActionChart",
            "component": "Button",
            "props": {
                "icon": "line-chart",
                "types": "link",
                "size": "small"
            }
        },
        {
            "id": "lrlActionSettings",
            "component": "Button",
            "props": {
                "icon": "settings",
                "types": "link",
                "size": "small"
            }
        },
        {
            "id": "mddHeader",
            "component": "div",
            "props": {
                "className": "flex items-center justify-between p-inset border-b border-divider"
            },
            "children": [
                "mddHeaderTitle",
                "mddHeaderRight"
            ]
        },
        {
            "id": "mddHeaderTitle",
            "component": "span",
            "props": {
                "className": "text-lg font-bold text-on-surface",
                "value": {
                    "path": "/mddDrawerTitle"
                }
            }
        },
        {
            "id": "mddHeaderRight",
            "component": "div",
            "props": {
                "className": "flex items-center gap-inline"
            },
            "children": [
                "mddTimeRangeText",
                "mddCloseBtn"
            ]
        },
        {
            "id": "mddTimeRangeText",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": {
                    "path": "/mddTimeRange"
                }
            }
        },
        {
            "id": "mddCloseBtn",
            "component": "Icon",
            "props": {
                "name": "x",
                "className": "w-5 h-5 cursor-pointer text-on-surface-variant hover:text-on-surface"
            }
        },
        {
            "id": "mddTabsContainer",
            "component": "div",
            "props": {
                "className": "px-inset pt-stack"
            },
            "children": [
                "mddTabs"
            ]
        },
        {
            "id": "mddTabs",
            "component": "Tabs",
            "props": {
                "activeKey": {
                    "path": "/mddActiveTab"
                },
                "className": "w-full"
            },
            "children": {
                "path": "/mddTabs",
                "componentId": "mddTabItem"
            }
        },
        {
            "id": "mddTabItem",
            "component": "TabItem",
            "props": {
                "key": {
                    "path": "key"
                },
                "label": {
                    "path": "label"
                }
            }
        },
        {
            "id": "mddScrollContent",
            "component": "div",
            "props": {
                "className": "flex-1 overflow-y-auto p-inset flex flex-col gap-section"
            },
            "children": [
                "mddBaseInfoCard",
                "mddTimeAxisPlaceholder",
                "mddChartsLoop"
            ]
        },
        {
            "id": "mddBaseInfoCard",
            "component": "div",
            "props": {
                "className": "bg-surface-variant p-gutter rounded-container flex flex-col gap-stack"
            },
            "children": [
                "mddBaseInfoRow1",
                "mddBaseInfoRow2"
            ]
        },
        {
            "id": "mddBaseInfoRow1",
            "component": "div",
            "props": {
                "className": "flex justify-between"
            },
            "children": [
                "mddDeviceNameGroup",
                "mddDevicePortGroup"
            ]
        },
        {
            "id": "mddDeviceNameGroup",
            "component": "div",
            "props": {
                "className": "flex flex-col"
            },
            "children": [
                "mddDeviceNameLabel",
                "mddDeviceNameValue"
            ]
        },
        {
            "id": "mddDeviceNameLabel",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "设备名称"
            }
        },
        {
            "id": "mddDeviceNameValue",
            "component": "span",
            "props": {
                "className": "text-md font-medium text-on-surface",
                "value": {
                    "path": "/mddBaseInfo/deviceName"
                }
            }
        },
        {
            "id": "mddDevicePortGroup",
            "component": "div",
            "props": {
                "className": "flex flex-col items-end"
            },
            "children": [
                "mddDevicePortLabel",
                "mddDevicePortValue"
            ]
        },
        {
            "id": "mddDevicePortLabel",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "设备端口"
            }
        },
        {
            "id": "mddDevicePortValue",
            "component": "span",
            "props": {
                "className": "text-md font-medium text-on-surface",
                "value": {
                    "path": "/mddBaseInfo/devicePort"
                }
            }
        },
        {
            "id": "mddBaseInfoRow2",
            "component": "div",
            "props": {
                "className": "flex items-center gap-inline"
            },
            "children": [
                "mddAggregationLabel",
                "mddAggregationSelect"
            ]
        },
        {
            "id": "mddAggregationLabel",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "聚合方式"
            }
        },
        {
            "id": "mddAggregationSelect",
            "component": "Select",
            "props": {
                "value": {
                    "path": "/mddBaseInfo/aggregationMethod"
                },
                "options": {
                    "path": "/mddAggregationOptions"
                },
                "size": "small",
                "className": "w-32"
            }
        },
        {
            "id": "mddTimeAxisPlaceholder",
            "component": "div",
            "props": {
                "className": "h-10 flex items-center justify-between px-inline border-t border-b border-divider relative"
            },
            "children": [
                "mddTimeTick0",
                "mddTimeTick1",
                "mddTimeTick2",
                "mddTimeTick3",
                "mddTimeTick4"
            ]
        },
        {
            "id": "mddTimeTick0",
            "component": "div",
            "props": {
                "className": "flex flex-col items-center relative"
            },
            "children": [
                "mddTickLineTop0",
                "mddTime0",
                "mddTickLineBottom0"
            ]
        },
        {
            "id": "mddTickLineTop0",
            "component": "div",
            "props": {
                "className": "absolute -top-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTime0",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "00:54"
            }
        },
        {
            "id": "mddTickLineBottom0",
            "component": "div",
            "props": {
                "className": "absolute -bottom-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTimeTick1",
            "component": "div",
            "props": {
                "className": "flex flex-col items-center relative"
            },
            "children": [
                "mddTickLineTop1",
                "mddTime1",
                "mddTickLineBottom1"
            ]
        },
        {
            "id": "mddTickLineTop1",
            "component": "div",
            "props": {
                "className": "absolute -top-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTime1",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "01:49"
            }
        },
        {
            "id": "mddTickLineBottom1",
            "component": "div",
            "props": {
                "className": "absolute -bottom-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTimeTick2",
            "component": "div",
            "props": {
                "className": "flex flex-col items-center relative"
            },
            "children": [
                "mddTickLineTop2",
                "mddTime2",
                "mddTickLineBottom2"
            ]
        },
        {
            "id": "mddTickLineTop2",
            "component": "div",
            "props": {
                "className": "absolute -top-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTime2",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "02:43"
            }
        },
        {
            "id": "mddTickLineBottom2",
            "component": "div",
            "props": {
                "className": "absolute -bottom-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTimeTick3",
            "component": "div",
            "props": {
                "className": "flex flex-col items-center relative"
            },
            "children": [
                "mddTickLineTop3",
                "mddTime3",
                "mddTickLineBottom3"
            ]
        },
        {
            "id": "mddTickLineTop3",
            "component": "div",
            "props": {
                "className": "absolute -top-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTime3",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "03:38"
            }
        },
        {
            "id": "mddTickLineBottom3",
            "component": "div",
            "props": {
                "className": "absolute -bottom-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTimeTick4",
            "component": "div",
            "props": {
                "className": "flex flex-col items-center relative"
            },
            "children": [
                "mddTickLineTop4",
                "mddTime4",
                "mddTickLineBottom4"
            ]
        },
        {
            "id": "mddTickLineTop4",
            "component": "div",
            "props": {
                "className": "absolute -top-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddTime4",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": "04:32"
            }
        },
        {
            "id": "mddTickLineBottom4",
            "component": "div",
            "props": {
                "className": "absolute -bottom-1 w-px h-1 bg-base"
            }
        },
        {
            "id": "mddChartsLoop",
            "component": "div",
            "props": {
                "className": "flex flex-col gap-section"
            },
            "children": {
                "path": "/mddMetrics",
                "componentId": "mddChartModule"
            }
        },
        {
            "id": "mddChartModule",
            "component": "div",
            "props": {
                "className": "flex flex-col gap-stack"
            },
            "children": [
                "mddChartTitle",
                "mddKpiRow",
                "mddLineChart"
            ]
        },
        {
            "id": "mddChartTitle",
            "component": "span",
            "props": {
                "className": "text-md font-bold text-on-surface",
                "value": {
                    "path": "chartTitle"
                }
            }
        },
        {
            "id": "mddKpiRow",
            "component": "div",
            "props": {
                "className": "flex gap-gutter"
            },
            "children": {
                "path": "kpis",
                "componentId": "mddKpiItem"
            }
        },
        {
            "id": "mddKpiItem",
            "component": "div",
            "props": {
                "className": "flex flex-col"
            },
            "children": [
                "mddKpiLabel",
                "mddKpiValue"
            ]
        },
        {
            "id": "mddKpiLabel",
            "component": "span",
            "props": {
                "className": "text-sm text-on-surface-variant",
                "value": {
                    "path": "label"
                }
            }
        },
        {
            "id": "mddKpiValue",
            "component": "span",
            "props": {
                "className": "text-md font-semibold text-primary",
                "value": {
                    "path": "value"
                }
            }
        },
        {
            "id": "mddLineChart",
            "component": "LineChart",
            "props": {
                "option": {
                    "data": {
                        "path": "chartData"
                    },
                    "xAxis": {
                        "data": "timestamp"
                    },
                    "yAxisTitle": {
                        "path": "unit"
                    },
                    "smooth": true
                },
                "className": "h-48 w-full"
            }
        }
    ]
};
>>>>>>> 0f0a81dbd994ccda47d0a0b233e707fdad6dd0a1
