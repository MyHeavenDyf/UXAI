/**
 * route-generator — 生成 src/routes/index.jsx
 *
 * 输入 pageNames → react-router-dom v7 `createBrowserRouter` 形态的默认导出对象。
 * 模板 main.jsx 的 `import router from './routes'` 直接消费 default export。
 */

export interface BuildRouterOptions {
  /** 默认路由重定向是否启用（首 page 重定向到根路径） */
  homeRedirect?: boolean
  /** 默认 path prefix，未传则每个页面用自身 name 作为路径 */
  prefix?: string
}

/**
 * 构造 src/routes/index.jsx 字符串。
 *
 * 示例：
 * ```jsx
 * import { createBrowserRouter, Navigate } from 'react-router-dom';
 * import App from '../App';
 *
 * import OrderAdminPage from '../pages/orderAdmin';
 *
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <App />,
 *     children: [
 *       { index: true, element: <Navigate to="/orderAdmin" replace /> },
 *       { path: 'orderAdmin', element: <OrderAdminPage /> },
 *     ],
 *   },
 * ]);
 *
 * export default router;
 * ```
 */
export function buildRouterFile(pageNames: string[], options: BuildRouterOptions = {}): string {
  const homeRedirect = options.homeRedirect !== false
  // child route path 用相对父路由 '/'（不加前缀）
  const prefix = options.prefix ?? ''
  // Navigate.to 必须是绝对路径
  const stripped = prefix.replace(/^\/+/, '')
  const navTarget = '/' + stripped + pageNames[0]  // e.g. '/orderAdmin'

  const lines: string[] = []

  lines.push("import { createBrowserRouter, Navigate } from 'react-router-dom';")
  lines.push("import App from '../App';")
  lines.push('')

  for (const name of pageNames) {
    const compName = pageNameToComponentName(name)
    lines.push(`import ${compName} from '../pages/${name}';`)
  }

  lines.push('')
  lines.push('const router = createBrowserRouter([')
  lines.push('  {')
  lines.push("    path: '/',")
  lines.push('    element: <App />,')
  lines.push('    children: [')

  if (homeRedirect && pageNames.length > 0) {
    lines.push(`      { index: true, element: <Navigate to="${navTarget}" replace /> },`)
  }

  for (const name of pageNames) {
    const compName = pageNameToComponentName(name)
    const pagePath = prefix + name
    lines.push(`      { path: '${pagePath}', element: <${compName} /> },`)
  }

  lines.push('    ],')
  lines.push('  },')
  lines.push(']);')
  lines.push('')
  lines.push('export default router;')

  return lines.join('\n')
}

/**
 * 页面目录名 → React 组件名（PascalCase + 'Page' 后缀）
 *   orderAdmin → OrderAdminPage
 *   user-profile → UserProfilePage
 *   my_app → MyAppPage
 */
export function pageNameToComponentName(pageName: string): string {
  const pascal = pageName
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return `${pascal}Page`
}
