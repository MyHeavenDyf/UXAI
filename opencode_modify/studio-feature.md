# Studio 图片生成功能

## 概述

合入 UXAI Studio 图片生成功能，添加即梦 AI 和内部图片生成工具，重命名 octo_canva → octo_studio。

## 提交记录

### `0b5c15aed` 合入 UXAI Studio 图片生成功能，重命名 octo_canva → octo_studio

- 所有文件中 `octo_canva` → `octo_studio`（agent 定义、prompt、skills 目录、session category map）
- 新增 `src/tool/jimeng_image_generate.ts`（392 行）：即梦 AI 图片生成，HMAC-SHA256 V4 签名
- 新增 `src/tool/internel_image_generate.ts`（616 行）：内部图片生成 API，创建任务/轮询模式
- 新增 `src/studio/image-provider.ts`：图片 provider 类型定义
- 新增 `src/studio/studio-service.ts`：图片生成协调服务
- 新增 Studio HTTP API 路由：Hono（`src/server/routes/instance/studio.ts`）和 Effect HttpApi（`groups/studio.ts` + `handlers/studio.ts`）
- `src/tool/registry.ts`：注册两个新工具为内置工具
