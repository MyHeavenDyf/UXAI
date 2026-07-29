// ⚠️ DEV-ONLY —— insight 组件隔离预览路由集合(/insight/__dev、/insight/__dev/*)。
//
// 从 octo-agent packages/app/src/pages/insight/_dev 迁移而来。原 octo-agent 决策:_dev 走
// LocalShell + 顶级 /_dev 路由,且 octo-sync 排除 _dev(不合入 UXAI)。本 UXAI 副本按既定
// 决策**不搬 LocalShell**——dev 页复用 UXAI 自己的壳(octo.tsx 的 RouterRoot),并把路由
// 收敛到 /insight/__dev 命名空间下(静态段优先于 /insight/:id?)。
//
// 隔离三层:
//   ① 构建隔离:调用点是 octo.tsx / app.tsx 的模块级常量 insightDevRoutesOrNone(见那里的长注释),
//      生产构建里折叠为 () => null → 本模块及全部 lazy chunk 被 Rollup 摇树掉,不进 bundle。
//      本文件这边的配合条件是 lazy()/PAGES 必须留在函数体内(见 insightDevRoutes 上方说明)。
//   ② 壳复用:/insight/__dev 直接渲染(insight 自带壳/无侧栏),dev 页本身是 size-full 自包含容器。
//      桌面端命中 octo.tsx 的 isInsightPage();浏览器端 app.tsx 用 isInsightDevPath 跳过 OctoSidebarLayout,
//      两端看到同一个壳(否则浏览器会多出一条旧侧栏,拿它验 UI 会被误导)。
//   ③ 路径隔离:显式静态段 /insight/__dev 优先于通配 /insight/:id?。
//
// 新增 dev 预览页:① 在下方 PAGES 加一条;② 在 index-preview.tsx 的 DEV_PAGES 加一条。
// 无需改 octo.tsx / app.tsx。
import { lazy } from "solid-js"
import type { JSX } from "solid-js"
import { Route } from "@solidjs/router"

/**
 * 返回全部 dev 路由。调用点须走模块级 DEV 守卫(见 octo.tsx / app.tsx 的 insightDevRoutesOrNone)。
 *
 * ⚠️ lazy() 与 PAGES 必须留在函数体内,不要提到模块顶层。
 * 模块顶层的 `const X = lazy(() => import("./x"))` 是 Rollup 眼里的**有副作用调用**:即便
 * insightDevRoutes 本身被摇掉,这些顶层调用仍会被保留,动态 import 照样各出一个 chunk 进生产包。
 * 放进函数体后,函数不可达 → 调用连同 import() 一起消失。
 * 注意这与调用点的守卫形态是**一对必须同时成立的条件**,单独满足任何一个都不足以摇干净。
 */
export function insightDevRoutes(): JSX.Element {
  const PAGES = [
    { path: "/insight/__dev", component: lazy(() => import("./index-preview")) },
    { path: "/insight/__dev/insight-cards", component: lazy(() => import("./cards-preview")) },
    { path: "/insight/__dev/typography", component: lazy(() => import("./typography-preview")) },
    { path: "/insight/__dev/result-tabs", component: lazy(() => import("./result-tabs-preview")) },
    { path: "/insight/__dev/file-fallback", component: lazy(() => import("./file-fallback-preview")) },
    { path: "/insight/__dev/attachment-bar", component: lazy(() => import("./attachment-bar-preview")) },
    { path: "/insight/__dev/panel-header", component: lazy(() => import("./panel-header-preview")) },
    { path: "/insight/__dev/attachment-parse", component: lazy(() => import("./attachment-parse-preview")) },
    { path: "/insight/__dev/permission-dock", component: lazy(() => import("./permission-dock-preview")) },
    { path: "/insight/__dev/question-dock", component: lazy(() => import("./question-dock-preview")) },
  ] as const
  return PAGES.map((p) => <Route path={p.path} component={p.component} />)
}
