# 分享网页打开 Octo Agent

网页拿到分享码后，用标准链接唤起 App，无需传递 ZIP 地址或登录凭据：

```html
<a href="octo-agent://share?uniqueId=Q8MtXNnCo9">打开 Octo Agent ↗</a>
```

动态生成链接时使用 `encodeURIComponent(uniqueId)`。Beta 包使用
`octo-agent-beta://share?uniqueId=...`。已安装的 App 需要包含此次新增的协议处理逻辑。
浏览器会显示自己的打开应用确认框，网页无需模拟系统弹窗。

交互按设计采用「在 Octo Agent 内继续」入口和同名弹窗，弹窗内提供
「打开 Octo Agent」按钮。用户取消浏览器确认框或关闭引导弹窗时，不触发导入。
独立 mock 分享页已经提供这个入口；正式分享网站可复用上述链接和交互。

App 收到链接后自动使用应用数据目录下的 `shared-sessions` 保存会话，不弹出目录选择框，然后：

如果本次启动仍在显示项目选择/欢迎引导，分享码先进入等待队列。
用户完成引导后才开始下列流程；App 已完成引导时直接处理，避免项目确认覆盖分享会话的跳转。

1. 读取 App 环境变量 `OCTO_SHARE_API_URL`，将接口路径末尾的
   `createShareSession` 替换为 `getShareSessionInfo`，传入 `uniqueId`。
2. 从返回的 `content.versionInfo[0]` 读取 `filePath`、`fileName`。
3. 从同一服务下载 `/tool{filePath}/{encodeURIComponent(fileName)}`。
4. 下载到独立临时目录，调用原有 `/session/import`，恢复对话、附件、产物。
5. 删除临时 ZIP，切换到应用管理的会话目录并打开导入后的对话，可继续交互。

内网请求复用 App 当前登录的 token 和 Cookie；本地 mock 无需登录。
同一 App 页面运行期间重复打开同一分享码，会定位已导入的对话。
分享失效、服务不可达或导入失败时，App 显示错误提示。

## 本地验证

App 的 `OCTO_SHARE_API_URL` 指向独立 mock 的上传接口。
启动包含本次修改的桌面程序，再打开 mock 的 `/share?uniqueId=...`，点击继续。
macOS/Windows 的协议唤起需要操作系统已注册对应 App；安装打包版本后验证最可靠。
开发启动会尝试注册协议，但 macOS 的 Electron 开发壳可能不支持同样的唤起行为。
