type DesignEntry = { name: string; filename: string }

// 获取 design 目录下所有文件的索引（文件名(无扩展名) → 文件名），通过 Electron IPC 调用主进程读取
export async function getDesignMap(): Promise<Map<string, string>> {
  const list: DesignEntry[] = await window.api.getDesignList()
  const map = new Map<string, string>()
  for (const entry of list) {
    map.set(entry.name, entry.filename)
  }
  return map
}

// 列出 design 目录下所有文件的名称（不含扩展名）
export async function listDesignNames(): Promise<string[]> {
  const map = await getDesignMap()
  return Array.from(map.keys())
}

// 根据文件名（不含扩展名）读取对应文件的文本内容，文件不存在则返回 null
export async function readDesignFile(name: string): Promise<string | null> {
  return window.api.getDesignContent(name)
}
