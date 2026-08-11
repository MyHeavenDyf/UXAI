// 文件夹流式上传的纯逻辑,从 index.tsx 抽出便于单测(避免 mock 闭包依赖)。
// 与 handlers/insight.ts uploadFolder 的撞名循环、path.posix.dirname 的目录切片同口径。

// relativePath(相对文件夹根,无前导斜杠)的目录部分:流式 subPath 拼接用。
// "sub/deep/file.txt" → "sub/deep";"file.txt" → ""。
export function folderRelativeDir(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/")
  return slash >= 0 ? relativePath.slice(0, slash) : ""
}

// 文件夹撞名解析:occupied 已占用名集合 → 返回 folderName 或 folderName (1)/(2)/...
// 与 handlers/insight.ts uploadFolder 的 finalFolderName 循环同口径(fetchInsightFiles 对
// uploads 类目同时返回文件与目录条目,故 occupied 能同时捕获文件夹名与文件名冲突)。
//
// TOCTOU:快照后到首次 copyFileToSessionUploads 之间是惰性创建,两个同名文件夹并发
// 拖入可能都选到同名,第二个走逐文件 collisionFreePath 静默合并 —— 与单文件路径既有
// 竞态同形态,可接受。
export function resolveFolderName(folderName: string, occupied: ReadonlySet<string>): string {
  let finalName = folderName
  let suffix = 1
  while (occupied.has(finalName)) {
    finalName = `${folderName} (${suffix})`
    suffix++
  }
  return finalName
}
