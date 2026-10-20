// 分享页 mock 数据:与 design 页面会话区对齐的真实 session 导出
// 来源:用户提供的真实 manifest.json(讲解Artifact用法会话)
export const MOCK_MANIFEST = {
  format: "octo-session",
  version: 1,
  exportedAt: 1791798020717,
  rootSessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
  sourceDirectory: "D:\\code\\octoAI",
  exclusions: [
    "credentials",
    "permissions",
    "share links",
    "active processes",
    "workspace binding",
  ],
  sessions: [
    {
      info: {
        id: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
        slug: "jolly-moon",
        projectID: "global",
        directory: "D:\\code\\octoAI",
        path: "D:/code/octoAI",
        title: "讲解Artifact用法",
        agent: "octo_make",
        category: "prototype",
        version: "local",
        summary: { additions: 0, deletions: 0, files: 0 },
        time: { created: 1791770306827, updated: 1791772855555 },
        sort_order: 0,
        pinned: false,
      },
      messages: [
        {
          info: {
            role: "user",
            time: { created: 1791770306898 },
            agent: "octo_make",
            model: { providerID: "octo-ai", modelID: "DeepSeek-V4-Flash" },
            summary: { diffs: [] },
            id: "msg_12dd52952001IfWfxU03reJiff",
            sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
          },
          parts: [
            {
              type: "text",
              text: "[Artifact Folder]: D:\\code\\octoAI\\.octo\\ses_ed22ad6f5ffeIOfCLEAAGsgrUS\\outputs\n优先使用 <artifact> 标签输出，默认不要使用 write 工具。仅当用户明确要求使用 write 工具时，才必须把文件写入此目录内，不得写到其他任何位置。\n\n[Existing artifacts in this session]\n- D:\\code\\octoAI\\.octo\\ses_ed22ad6f5ffeIOfCLEAAGsgrUS\\outputs\\.gitkeep\n用户在本会话中要求修改此前生成的产物时，请对上面匹配的文件路径使用 edit 工具。若目标文件不在列表中，则改为重新输出完整的 <artifact>，不要编辑此列表之外的文件。\n---\n11",
              id: "prt_12dd52952002gAy6BjAHZlrBN5",
              sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
              messageID: "msg_12dd52952001IfWfxU03reJiff",
            },
          ],
        },
        {
          info: {
            parentID: "msg_12dd52952001IfWfxU03reJiff",
            role: "assistant",
            mode: "octo_make",
            agent: "octo_make",
            path: { cwd: "D:\\code\\octoAI", root: "/" },
            cost: 0,
            tokens: { total: 16680, input: 16594, output: 86, reasoning: 0, cache: { write: 0, read: 0 } },
            modelID: "DeepSeek-V4-Flash",
            providerID: "octo-ai",
            time: { created: 1791770306927, completed: 1791770314234 },
            finish: "stop",
            id: "msg_12dd5296f001DFU0hfaangFM08",
            sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
          },
          parts: [
            { type: "step-start", id: "prt_12dd53cce001fPbI96Hq1TvtR8", sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", messageID: "msg_12dd5296f001DFU0hfaangFM08" },
            {
              type: "text",
              text: "好的，请告诉我您的需求！我会帮您用 HTML、SVG 或 Markdown 来呈现您的设计想法。\n\n请问您今天想做什么呢？比如：\n\n- 设计一个着陆页 / 产品展示页\n- 制作一个图标或插画（SVG）\n- 写一份 Markdown 文档\n- 设计一个仪表盘或应用界面\n- 其他任何设计相关的想法",
              time: { start: 1791770311915, end: 1791770314231 },
              id: "prt_12dd53ceb001bbqbL1oYp0zOEl",
              sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
              messageID: "msg_12dd5296f001DFU0hfaangFM08",
            },
            { reason: "stop", type: "step-finish", tokens: { total: 16680, input: 16594, output: 86, reasoning: 0, cache: { write: 0, read: 0 } }, cost: 0, id: "prt_12dd545f80011tCQfCf23Pl2sl", sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", messageID: "msg_12dd5296f001DFU0hfaangFM08" },
          ],
        },
        {
          info: {
            role: "user",
            time: { created: 1791772848241 },
            agent: "octo_make",
            model: { providerID: "octo-ai", modelID: "DeepSeek-V4-Flash" },
            summary: { diffs: [] },
            id: "msg_12dfbf071001647WRe5HGKzqwy",
            sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
          },
          parts: [
            {
              type: "text",
              text: "[Artifact Folder]: D:\\code\\octoAI\\.octo\\ses_ed22ad6f5ffeIOfCLEAAGsgrUS\\outputs\n优先使用 <artifact> 标签输出，默认不要使用 write 工具。仅当用户明确要求使用 write 工具时，才必须把文件写入此目录内，不得写到其他任何位置。\n\n[Existing artifacts in this session]\n- D:\\code\\octoAI\\.octo\\ses_ed22ad6f5ffeIOfCLEAAGsgrUS\\outputs\\.gitkeep\n用户在本会话中要求修改此前生成的产物时，请对上面匹配的文件路径使用 edit 工具。若目标文件不在列表中，则改为重新输出完整的 <artifact>，不要编辑此列表之外的文件。\n---\n你好",
              id: "prt_12dfbf072001A76fHLmfIhRo4O",
              sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
              messageID: "msg_12dfbf071001647WRe5HGKzqwy",
            },
            {
              type: "file",
              filename: "test-preview.svg",
              mime: "image/svg+xml",
              id: "prt_test_file_1",
              sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
              messageID: "msg_12dfbf071001647WRe5HGKzqwy",
            },
          ],
        },
        {
          info: {
            parentID: "msg_12dfbf071001647WRe5HGKzqwy",
            role: "assistant",
            mode: "octo_make",
            agent: "octo_make",
            path: { cwd: "D:\\code\\octoAI", root: "/" },
            cost: 0,
            tokens: { total: 16967, input: 16853, output: 114, reasoning: 0, cache: { write: 0, read: 0 } },
            modelID: "DeepSeek-V4-Flash",
            providerID: "octo-ai",
            time: { created: 1791772848275, completed: 1791772855552 },
            finish: "stop",
            id: "msg_12dfbf093001mRTUpIVlhx89mr",
            sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
          },
          parts: [
            { type: "step-start", id: "prt_12dfc00cf001n3wSWLa0Ggn9kP", sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", messageID: "msg_12dfbf093001mRTUpIVlhx89mr" },
            {
              type: "text",
              text: "你好！欢迎来到设计助手。请问你今天有什么设计需求？比如：\n\n1. **网页设计** — 落地页、产品页、登录页等\n2. **SVG 图标/插画** — Logo、装饰图形、流程图等\n3. **Markdown 文档** — 产品需求文档、设计规范等\n4. **UI 组件** — 按钮、卡片、导航栏、表格等\n5. **其他** — 任何你想让我帮忙设计的视觉内容\n\n告诉我你的想法，我来帮你实现！",
              time: { start: 1791772852528, end: 1791772855550 },
              id: "prt_12dfc01300014pMnpSpXhiv7rG",
              sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS",
              messageID: "msg_12dfbf093001mRTUpIVlhx89mr",
            },
            { reason: "stop", type: "step-finish", tokens: { total: 16967, input: 16853, output: 114, reasoning: 0, cache: { write: 0, read: 0 } }, cost: 0, id: "prt_12dfc0cff001JtJGM2ZQagKXS6", sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", messageID: "msg_12dfbf093001mRTUpIVlhx89mr" },
          ],
        },
      ],
      todos: [],
    },
  ],
  files: [
    { sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", scope: "session", directory: ".", path: ".gitkeep", size: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", blob: "blobs/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", scope: "session", directory: ".", path: "outputs/.gitkeep", size: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", blob: "blobs/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", scope: "session", directory: ".", path: "resource/assets_config.json", size: 387, sha256: "faea841e33d10fe6bec1f4901b88eed93cca9e711ac6d03c953a65f078a32908", blob: "blobs/faea841e33d10fe6bec1f4901b88eed93cca9e711ac6d03c953a65f078a32908" },
    { sessionID: "ses_ed22ad6f5ffeIOfCLEAAGsgrUS", scope: "session", directory: ".", path: "outputs/test-preview.svg", size: 225, sha256: "5f2205307dda0be5d3d54a5637d325360d94e27b36d6f5c05c38fe4159cfbc50", blob: "blobs/5f2205307dda0be5d3d54a5637d325360d94e27b36d6f5c05c38fe4159cfbc50" },
  ],
}

// blob 文件内容:sha256 → Buffer,供 mock blob handler 返回
// 测试图片:80×80 蓝色圆角 SVG
const TEST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#0969ff" rx="8"/><text x="40" y="46" text-anchor="middle" fill="#fff" font-size="12" font-family="sans-serif">TEST</text></svg>'
export const MOCK_BLOBS = {
  // 空文件(.gitkeep)
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855": Buffer.alloc(0),
  // 测试图片 SVG
  "5f2205307dda0be5d3d54a5637d325360d94e27b36d6f5c05c38fe4159cfbc50": Buffer.from(TEST_SVG, "utf8"),
}

// getShareSessionInfo 返回的 filePath;manifest 实际由 /tool{filePath}/manifest.json 提供
export const MOCK_FILE_PATH = "/designAgentPreview/share-mock"
