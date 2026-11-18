import type { SubtypeHandler, Scene3dEditConfig, SubtypeHandlerContext, HistoryTriggerEvent } from './types'
import type { VersionFile } from '../utils/history-store'
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

// 历史快照需覆盖的文件（相对 tab.filePath 即 index.3d.html 所在目录）：
//   '.'                              → index.3d.html 离线预览容器（shell，版本文件夹内记为 self.html，与 default 旧版本兼容）
//   './preview/scene-data.js'        → 离线构建内嵌的 scene-data，host blob 刷新实际加载它（预览真正读的内容）
//   './source/public/scene3d/scene-data.json' → AI 回写的源码（source of truth），漏了它 switchVersion 后下次 AI 编辑会读最新源码而非恢复后的版本
// 只记 '.' 会把 shell 当成内容：switchVersion 只回写 shell、预览不变（blob 刷新仍读最新 preview/scene-data.js）、源码也不回退——历史"不生效/记录不对"。
const SCENE3D_HISTORY_RELS = ['.', './preview/scene-data.js', './source/public/scene3d/scene-data.json']

const scene3dHandler: SubtypeHandler = {
  ...defaultHandler,
  // subtype 名 '3d':来自 extractSubtypeFromFilename("index.3d.html") → "3d"
  // （与 index.gts.html → "gts" 约定一致）
  name: '3d',
  // 3D 元素非 DOM 组件,不启用属性面板编辑;改走 scene3dEditConfig(postMessage 回写)
  modelEditConfig: undefined,
  scene3dEditConfig,

  /** 历史记录入口 1：决定每次记录哪些文件。
   *  index.3d.html 是 FIXED 离线预览容器（shell，仅 ?v= 与 styles 随构建变化），真正承载场景状态的是
   *  preview/scene-data.js（离线构建内嵌的 scene-data，iframe 实际加载它）与
   *  source/public/scene3d/scene-data.json（AI 回写的源码 source of truth）。
   *  agent-update 时跳过：tab 内容先于磁盘文件变化，此时 recordVersion 会复制到尚未重建完成的中间态文件。 */
  async onHistoryTrigger(event: HistoryTriggerEvent, ctx: SubtypeHandlerContext): Promise<string[] | null> {
    if (event.type === 'agent-update') return null
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!tab.filePath) return null
    const dir = tab.filePath.replace(/[\\/][^\\/]+$/, '')
    if (!api?.statFile) return SCENE3D_HISTORY_RELS
    const exists = await Promise.all(
      SCENE3D_HISTORY_RELS.map((rel) => {
        const abs = rel === '.' ? tab.filePath! : `${dir}/${rel.replace(/^\.\//, '')}`
        return api.statFile!(abs).then(() => true).catch(() => false)
      }),
    )
    const rels = SCENE3D_HISTORY_RELS.filter((_, i) => exists[i])
    // 至少保留 '.'（index.3d.html 必然存在），保证 recordVersion copied>0 能落版本
    return rels.length > 0 ? rels : ['.']
  },

  /** 历史记录入口 2：版本恢复。
   *  files 已携带 originalPath，逐个复制回原始路径即可。
   *  index.3d.html + preview/scene-data.js + scene-data.json 全部回退后，
   *  setFilesRefreshKey 会触发 host 的 3D blob 刷新（重新 fetch 主文档 + 内联 ./preview/ 子资源，
   *  绕过 local:// 持久化缓存），预览即与恢复后的源码一致。 */
  async applyVersionFiles(ctx: SubtypeHandlerContext, files: VersionFile[]): Promise<void> {
    const { tab, getDesktopApi } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !tab.filePath) return
    for (const f of files) {
      try {
        await api.copyFileTo(f.filePath, f.originalPath)
      } catch {
        // 版本里缺该文件时静默跳过
      }
    }
  },
}

export default scene3dHandler
