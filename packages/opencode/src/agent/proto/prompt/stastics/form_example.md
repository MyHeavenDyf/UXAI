{
  "state": { "username": "","country": "","hobbies": [],"notification": true,"birthday": "" },
  "rootId": "mainFormContainer",
  "elements": [
    { "id": "mainFormContainer", "component": "div", "props": { "className": "p-6 max-w-lg mx-auto bg-white rounded-xl" }, "children": ["mainFormTitle", "mainFormContent", "mainFormBtn"] },
    { "id": "mainFormTitle", "component": "h2", "props": { "value": "用户信息收集", "className": "text-xl font-bold text-slate-800 mb-6" } },
    { "id": "mainFormContent", "component": "div", "props": { "className": "flex flex-col gap-5" }, "children": ["mainFormUsernameField", "mainFormBirthdayField", "mainFormCountryField", "mainFormHobbiesField", "mainFormNotificationField"] },
    { "id": "mainFormUsernameField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormUsernameLabel", "mainFormUsernameInput"] },
    { "id": "mainFormUsernameLabel", "component": "span", "props": { "value": "用户名", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormUsernameInput", "component": "Input", "props": { "value": { "path": "/username" }, "placeholder": "请输入用户名", "prefix": "User", "className": "w-full" } },
    { "id": "mainFormBirthdayField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormBirthdayLabel", "mainFormBirthdayPicker"] },
    { "id": "mainFormBirthdayLabel", "component": "span", "props": { "value": "生日", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormBirthdayPicker", "component": "DatePicker", "props": { "value": { "path": "/birthday" }, "placeholder": "选择日期", "picker": "date", "className": "w-full" } },
    { "id": "mainFormCountryField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormCountryLabel", "mainFormCountrySelect"] },
    { "id": "mainFormCountryLabel", "component": "span", "props": { "value": "国家", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormCountrySelect", "component": "Select", "props": { "value": { "path": "/country" }, "placeholder": "请选择国家", "options": [{ "label": "中国", "value": "cn" }, { "label": "美国", "value": "us" }, { "label": "日本", "value": "jp" }, { "label": "英国", "value": "uk" }], "className": "w-full" } },
    { "id": "mainFormHobbiesField", "component": "div", "props": { "className": "flex flex-col gap-2" }, "children": ["mainFormHobbiesLabel", "mainFormHobbiesCheckbox"] },
    { "id": "mainFormHobbiesLabel", "component": "span", "props": { "value": "爱好", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormHobbiesCheckbox", "component": "CheckboxGroup", "props": { "value": { "path": "/hobbies" }, "options": [{ "label": "阅读", "value": "reading" }, { "label": "运动", "value": "sports" }, { "label": "音乐", "value": "music" }, { "label": "旅行", "value": "travel" }] } },
    { "id": "mainFormNotificationField", "component": "div", "props": { "className": "flex items-center justify-between" }, "children": ["mainFormNotificationLabel", "mainFormNotificationSwitch"] },
    { "id": "mainFormNotificationLabel", "component": "span", "props": { "value": "接收通知", "className": "text-sm font-medium text-slate-700" } },
    { "id": "mainFormNotificationSwitch", "component": "Switch", "props": { "value": { "path": "/notification" }, "checkedChildren": "开", "unCheckedChildren": "关" } },
    { "id": "mainFormBtn", "component": "Button", "props": { "value": "提交", "type": "primary", "className": "w-full mt-6" } }
  ]
}