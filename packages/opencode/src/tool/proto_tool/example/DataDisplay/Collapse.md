# Collapse

### Example: Demonstrating the Component Composition between Collapse and CollapseItem, featuring Slot Syntax for flexible content distribution within individual items.

```json
{
  "state": {
    "activeKey": ["resetPassword"],
    "faqList": [
      {
        "id": "resetPassword",
        "question": "如何重置密码？",
        "anwser": "在登录页面点击忘记密码，按提示操作即可重置"
      },
      {
        "id": "contactCustomerService",
        "label": "如何联系客服？",
        "content": "您可以通过在线客服或拨打客服热线400-xxx-xxxx"
      },
      {
        "id": "viewOrder",
        "label": "如何查看订单？",
        "content": "登录后进入个人中心查看订单详情"
      }
    ]
  },
  "rootId": "collapseFaq",
  "elements": [
    {
      "id": "collapseFaq",
      "component": "Collapse",
      "props": {
        "activeKey": { "path": "/activeKey" },
      },
      "children": {
        "path": "/faqList",
        "componentId": "faqItem"
    	}
    },
    {
      "id": "faqItem",
      "component": "CollapseItem",
      "props": {
        "key": { "path": "id" },
        "label": { "path": "label" },
        "content": { "componentId": "collapseContent" }
      }
    },
    {
      "id": "collapseContent",
      "component": "div",
      "props": { "className": "p-4", "value": { "path": "content" } }
    }
  ]
}

```

### Example: Applicable to asymmetric attribute structures, not applicable to loops, and tiles all items. Slot Syntax (`componentId`) works in static tiling mode too, enabling complex component composition.

```json	
{
  "id": "userGuide",
  "component": "Collapse",
  "props": {
    "activeKey": { "value": "first" },
    "size": "large",
    "expandIcon": "chevron-down",
    "expandIconPlacement": "end",
    "accordion": true,
  },
  "children": ["first", "second", "third"]
},
{
  "id": "first",
  "component": "CollapseItem",
  "props": {
    "key": "first",
    "label": "第一步：注册账号",
    "content": { "componentId": "firstContent" },
    "extra": {"componentId": "tips"}
  }
},
{
  "id": "second",
  "component": "CollapseItem",
  "props": {
    "key": "second",
    "label": "第二步：完善资料",
    "content": "在个人中心完善个人资料信息"
  }
},
{
  "id": "third",
  "component": "CollapseItem",
  "props": {
    "key": "third",
    "label": "第三步：开始使用",
    "content": "完成以上步骤后即可开始使用系统功能"
  }
},
{
  "id": "tips",
  "component": "Icon",
  "props": { "name": "circle-question-mark" }
},
{
  "id": "firstContent",
  "component": "div",
  "props": { "className": "flex flex-col gap-2 p-4" },
  "children": ["firstTitle", "firstTips"]
},
{
  "id": "firstTitle",
  "component": "span",
  "props": { "className": "font-semibold text-slate-800", "value": "点击注册按钮，填写相关信息完成账号注册" }
},
{
  "id": "firstTips",
  "component": "span",
  "props": { "className": "text-sm text-slate-500", "value": "密码需要含有大小写字母 + 数字 + 符号，且密码长度大于8位" }
}

```