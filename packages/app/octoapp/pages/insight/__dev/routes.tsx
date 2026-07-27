// ⚠️ DEV-ONLY —— insight 组件隔离预览路由集合(/insight/__dev、/insight/__dev/*)。
//
// 从 octo-agent packages/app/src/pages/insight/_dev 迁移而来。原 octo-agent 决策:_dev 走
// LocalShell + 顶级 /_dev 路由,且 octo-sync 排除 _dev(不合入 UXAI)。本 UXAI 副本按既定
// 决策**不搬 LocalShell**——dev 页复用 UXAI 自己的壳(octo.tsx 的 RouterRoot),并把路由
// 收敛到 /insight/__dev 命名空间下(静态段优先于 /insight/:id?)。
//
// 隔离三层:
//   ① 构建隔离:insightDevRoutes() 仅在 octo.tsx 的 `import.meta.env.DEV && ...` 分支调用,
//      生产构建里调用点为死代码 → 本模块及全部 lazy chunk 被 Rollup 摇树掉,不进 bundle。
//   ② 壳复用:/insight/__dev 命中 octo.tsx 的 isInsightPage(),直接渲染(insight 自带壳/无侧栏),
//      dev 页本身是 size-full 自包含容器。
//   ③ 路径隔离:显式静态段 /insight/__dev 优先于通配 /insight/:id?。
//
// 新增 dev 预览页:① 在下方 PAGES 加一条;② 在 index-preview.tsx 的 DEV_PAGES 加一条。无需改 octo.tsx。
import { lazy } from "solid-js"
import type { JSX } from "solid-js"
import { Route } from "@solidjs/router"

const DevIndexPage = lazy(() => import("./index-preview"))
const InsightCardsDevPage = lazy(() => import("./cards-preview"))
const TypographyDevPage = lazy(() => import("./typography-preview"))
const ResultTabsDevPage = lazy(() => import("./result-tabs-preview"))
const FileFallbackDevPage = lazy(() => import("./file-fallback-preview"))
const AttachmentBarDevPage = lazy(() => import("./attachment-bar-preview"))
const PanelHeaderDevPage = lazy(() => import("./panel-header-preview"))
const AttachmentParseDevPage = lazy(() => import("./attachment-parse-preview"))

const PAGES = [
  { path: "/insight/__dev", component: DevIndexPage },
  { path: "/insight/__dev/insight-cards", component: InsightCardsDevPage },
  { path: "/insight/__dev/typography", component: TypographyDevPage },
  { path: "/insight/__dev/result-tabs", component: ResultTabsDevPage },
  { path: "/insight/__dev/file-fallback", component: FileFallbackDevPage },
  { path: "/insight/__dev/attachment-bar", component: AttachmentBarDevPage },
  { path: "/insight/__dev/panel-header", component: PanelHeaderDevPage },
  { path: "/insight/__dev/attachment-parse", component: AttachmentParseDevPage },
] as const

/** 返回全部 dev 路由。调用点须加 import.meta.env.DEV 守卫(见 octo.tsx)。 */
export function insightDevRoutes(): JSX.Element {
  return PAGES.map((p) => <Route path={p.path} component={p.component} />)
}
