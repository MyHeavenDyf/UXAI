// 大文件归档 LazyFile:渲染进程零物化,字节按需从主进程 IPC 流式拉。
//
// 背景:read-file-buffer 整份读盘 → 跨 IPC 结构化克隆,V8 ArrayBuffer 单对象 ~2GB 上限,
// 2.5GB 直接 RangeError,被 ipc.ts 的 catch {} 静默成 null → archive-flow.tsx 弹"无法获取文件内容"。
// 同源 iframe EDM SDK 支持分片,调用模式是 chunk = file.slice(start, end); await chunk.arrayBuffer()。
//
// 思路:返回一个**真 File**(`new File([], name)` 有内部槽,过 instanceof File / DataTransfer.items.add 校验),
// 但覆写 `size` getter 为真实大小、`slice()` 返回的真 Blob 其 `arrayBuffer` 才按 range 拉 [start, end) 字节。
// iframe 同源直接引用传递(不走 postMessage),覆写的 getter 透传过去,SDK 调 slice 时才真正读盘。
//
// 注意:
// · `arrayBuffer()` 直读守卫:若 iframe SDK 错走整份读(而非分片 slice),明确抛错,避免静默空文件。
// · postMessage 兜底缺失:若 iframe 实际用 postMessage 传 FileList,结构化克隆会丢覆写、得空 File,
//   `arrayBuffer()` 守卫会暴露这个错。届时改走 chunk 协议(MessageChannel 逐片拉),非本工具职责。

const LAZY_FILE_THRESHOLD = 256 * 1024 * 1024

interface LazyFileSource {
  /** 拉 [start, end) 字节,渲染端不物化整份 */
  readRange: (start: number, end: number) => Promise<ArrayBuffer>
}

export interface LazyFileOpts extends LazyFileSource {
  size: number
  name: string
  mime?: string
  lastModified?: number
}

export function makeLazyFile(opts: LazyFileOpts): File {
  const file = new File([], opts.name, {
    type: opts.mime || undefined,
    lastModified: opts.lastModified ?? Date.now(),
  })
  // size 走真实大小,而非底层空 ByteSequence 的 0
  Object.defineProperty(file, "size", {
    get: () => opts.size,
    configurable: true,
    enumerable: true,
  })
  // slice 返回真 Blob(过 instanceof Blob);其 arrayBuffer / stream 才按需拉字节
  const lazySlice = (start?: number, end?: number, contentType?: string): Blob => {
    const s = Math.max(0, Math.min(start ?? 0, opts.size))
    const e = Math.max(s, Math.min(end ?? opts.size, opts.size))
    const blob = new Blob([], { type: contentType ?? opts.mime ?? "" })
    Object.defineProperty(blob, "size", {
      get: () => e - s,
      configurable: true,
      enumerable: true,
    })
    // arrayBuffer 内部分片拉 + 拼接:readRange(IPC)单次硬上限 16MB,
    // 直接传整个 slice 会被静默截断到 16MB → SDK 拿到短数据 → 静默数据损坏。
    // 单次 arrayBuffer 物化上限 256MB(防 SDK 切超大 slice 调 arrayBuffer 把渲染端 OOM)。
    blob.arrayBuffer = async () => {
      const total = e - s
      const MAX_ARRAYBUFFER = 256 * 1024 * 1024
      if (total > MAX_ARRAYBUFFER) {
        throw new Error(
          `LazyFile.slice().arrayBuffer() slice too large: ${total} bytes > ${MAX_ARRAYBUFFER}; use smaller slices`,
        )
      }
      const CHUNK = 8 * 1024 * 1024
      if (total <= CHUNK) return opts.readRange(s, e)
      const out = new Uint8Array(total)
      let pos = s
      while (pos < e) {
        const chunkEnd = Math.min(pos + CHUNK, e)
        const buf = await opts.readRange(pos, chunkEnd)
        out.set(new Uint8Array(buf), pos - s)
        pos = chunkEnd
      }
      return out.buffer
    }
    // stream():1MB / pull 分片拉(若 SDK 用 stream 而非 slice+arrayBuffer)
    blob.stream = () => {
      let pos = s
      return new ReadableStream({
        async pull(controller) {
          if (pos >= e) {
            controller.close()
            return
          }
          const chunkEnd = Math.min(pos + 1024 * 1024, e)
          const buf = await opts.readRange(pos, chunkEnd)
          controller.enqueue(new Uint8Array(buf))
          pos = chunkEnd
        },
      })
    }
    blob.text = async () => new TextDecoder().decode(await blob.arrayBuffer())
    return blob
  }
  Object.defineProperty(file, "slice", {
    value: lazySlice,
    configurable: true,
    enumerable: true,
    writable: true,
  })
  // arrayBuffer 直读守卫:LazyFile 不物化整份,SDK 应走 slice 分片
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      throw new Error("LazyFile.arrayBuffer() unsupported: use slice() + chunk readRange")
    },
    configurable: true,
    enumerable: true,
    writable: true,
  })
  Object.defineProperty(file, "stream", {
    value: () => lazySlice(0, opts.size).stream(),
    configurable: true,
    enumerable: true,
    writable: true,
  })
  Object.defineProperty(file, "text", {
    value: async () => {
      throw new Error("LazyFile.text() unsupported: use slice() + chunk readRange")
    },
    configurable: true,
    enumerable: true,
    writable: true,
  })
  return file
}

/** 大小阈值:超过则走 LazyFile 流式,否则走 readFileBuffer 整份物化(小文件保原路径、风险最小) */
export function shouldUseLazyFile(size: number): boolean {
  return size > LAZY_FILE_THRESHOLD
}
