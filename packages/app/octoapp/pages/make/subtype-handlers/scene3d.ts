import type { SubtypeHandler, Scene3dEditConfig } from './types'
import defaultHandler from './default'

// generate-3d-scene skill 的根目录。
// 离线构建必须用 skill 自带的 scripts/build-offline.mjs(它会:
//   ① ensure 共享依赖环境(SCENE3D_ENV_DIR);
//   ② 在临时目录建 node_modules junction(不在 source 装依赖);
//   ③ 以 NODE_ENV=production 跑 vite build,把 import.meta.env.DEV 静态替换为 false,
//     剥掉 dev 分支的 fetch('/__scene3d/save-scene')(host iframe 内该端点 404)。
// source/scripts/build-offline.mjs 不能直接跑——source 没有 node_modules。
// NOTE: 本文件跑在浏览器(Vite dev),不能用 process.env;此路径只用在发给 AI 的
// prompt 文本里,迁移 skill 时改这里即可。
const SCENE3D_SKILL_ROOT =
  'D:/appProject/ai-for-gdesign/ai-for-g-cyc/ai-for-design/ai-for-design/skills/generate-3d-scene'

// index.3d.html 是 FIXED 离线预览容器,不可直接编辑。
// 真正源码在 source/ 下(scene-data.json 在 source/public/scene3d/scene-data.json)。
// 3D 编辑器内置在 iframe 里,SaveService 保存时通过 parent.postMessage(od:scene3d-save)
// 把 scene3d-changes 文本回传 host;host 包一层源码定位 + 构建指令,发给 AI 回写并重构建。
function wrapScene3dPrompt(filePath: string, body: string): string {
  const previewRoot = filePath.replace(/[\\/][^\\/]+$/, '')
  return [
    `预览页面源码根目录:${previewRoot}`,
    '该预览由 generate-3d-scene skill 构建生成,index.3d.html 是离线预览容器,不可直接编辑。',
    '真正源码在 source/ 目录下(scene-data.json 在 source/public/scene3d/scene-data.json)。',
    '请按下方 scene3d-changes 修改 scene-data.json,然后重新构建离线页面。',
    '',
    body,
    '',
    '操作要求:',
    '1. 逐项核对 before;不匹配时不要覆盖已有修改',
    '2. path 是路径数组;缺少 after 表示删除,数组整体替换',
    `3. 把修改应用到 ${previewRoot}/source/public/scene3d/scene-data.json`,
    '4. 必须用 skill 自带的构建脚本(不要用 source/scripts/build-offline.mjs,它依赖 node_modules 会失败;也不要用 npm run build,那是 dev 构建会保留 fetch 导致 404):',
    `   node "${SCENE3D_SKILL_ROOT}/scripts/build-offline.mjs" "${previewRoot}"`,
    '5. 图片 data URI 为资源内容,请保留或落盘后更新引用',
    '6. 只改 scene-data.json,不要改 index.3d.html',
  ].join('\n')
}

// SaveService 通过 postMessage(od:scene3d-save) 回传的 text 含
// "请将以下场景修改..." prefix + JSON payload(format: 'scene3d-changes')
export const scene3dEditConfig: Scene3dEditConfig = {
  buildPrompt: ({ filePath, payload }) => wrapScene3dPrompt(filePath, payload),
}

const scene3dHandler: SubtypeHandler = {
  ...defaultHandler,
  // subtype 名 '3d':来自 extractSubtypeFromFilename("index.3d.html") → "3d"
  // （与 index.gts.html → "gts" 约定一致）
  name: '3d',
  // 3D 元素非 DOM 组件,不启用属性面板编辑;改走 scene3dEditConfig(postMessage 回写)
  modelEditConfig: undefined,
  scene3dEditConfig,
}

export default scene3dHandler
