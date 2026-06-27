import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Plugin, ViteDevServer } from 'vite'

interface TreeNode {
  label: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const testDir = path.resolve(__dirname, '../test-project/test')

export default function testFilesPlugin(): Plugin {
  const virtualModuleId = 'virtual:test-files'
  const resolvedVirtualModuleId = '\0' + virtualModuleId
  let server: ViteDevServer | null = null

  // 防抖：多次文件变化只触发一次更新
  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      if (!server) return
      const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId)
      if (mod) {
        server.moduleGraph.invalidateModule(mod)
      }
      server.ws.send({ type: 'full-reload' })
      console.log('[test-files] 检测到 test 目录变化，页面已刷新')
    }, 300)
  }

  return {
    name: 'test-files',

    resolveId(id: string) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId
      }
    },

    load(id: string) {
      if (id === resolvedVirtualModuleId) {
        // 只返回目录结构，不包含 JSON 内容
        const tree = scanDirectory(testDir)
        return `export default ${JSON.stringify(tree)}`
      }
    },

    configureServer(s) {
      server = s

      // 添加中间件：按需返回单个 JSON 文件内容
      s.middlewares.use('/api/test-file', (req, res) => {
        // 解析 URL 参数
        const url = new URL(req.url || '/', `http://${req.headers.host}`)
        const filePath = url.searchParams.get('path')

        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing path parameter' }))
          return
        }

        // 安全校验：防止路径穿越
        const fullPath = path.resolve(testDir, filePath)
        const normalizedTestDir = testDir.replace(/\\/g, '/')
        const normalizedFullPath = fullPath.replace(/\\/g, '/')
        if (!normalizedFullPath.startsWith(normalizedTestDir)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Access denied' }))
          return
        }

        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (!content || !content.trim()) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'File is empty', path: filePath }))
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          })
          res.end(content)
        } catch (err: any) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'File not found', detail: err.message }))
        }
      })

      // 监听 test 目录下的文件变化
      s.watcher.add(testDir)
      s.watcher.on('all', (_event: string, filePath: string) => {
        const normalizedTestDir = testDir.replace(/\\/g, '/')
        const normalizedPath = filePath.replace(/\\/g, '/')
        if (!normalizedPath.startsWith(normalizedTestDir)) return
        scheduleReload()
      })
    },

    // 构建模式下的文件变化监听
    watchChange(id: string) {
      const normalizedTestDir = testDir.replace(/\\/g, '/')
      const normalizedId = id.replace(/\\/g, '/')
      if (normalizedId.startsWith(normalizedTestDir) && normalizedId.endsWith('.json')) {
        console.log(`[test-files] 文件变化: ${normalizedId}`)
      }
    }
  }
}

function naturalCompare(a: string, b: string): number {
  // 自然排序：将字符串拆分为文本段和数字段进行比较
  const re = /(\d+)|(\D+)/g
  const aParts = a.match(re) || []
  const bParts = b.match(re) || []
  const len = Math.min(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const aIsNum = /^\d+$/.test(aParts[i])
    const bIsNum = /^\d+$/.test(bParts[i])
    if (aIsNum && bIsNum) {
      const diff = Number(aParts[i]) - Number(bParts[i])
      if (diff !== 0) return diff
    } else {
      const cmp = aParts[i].localeCompare(bParts[i])
      if (cmp !== 0) return cmp
    }
  }
  return aParts.length - bParts.length
}

function scanDirectory(dir: string, relativePath = ''): TreeNode[] {
  const result: TreeNode[] = []

  try {
    const items = fs.readdirSync(dir)
    items.sort(naturalCompare)

    for (const item of items) {
      const fullPath = path.join(dir, item)
      const stat = fs.statSync(fullPath)
      const relPath = relativePath ? `${relativePath}/${item}` : item

      if (stat.isDirectory()) {
        const children = scanDirectory(fullPath, relPath)
        result.push({
          label: item,
          path: relPath,
          isDirectory: true,
          children
        })
      } else if (item.endsWith('.json')) {
        // 只记录文件路径，不读取内容
        result.push({
          label: item,
          path: relPath,
          isDirectory: false
        })
      }
    }
  } catch {
    // skip if directory doesn't exist
  }

  return result
}