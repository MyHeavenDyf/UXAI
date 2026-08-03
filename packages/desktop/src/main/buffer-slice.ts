// Node Buffer → 可跨 IPC 传输的精确 ArrayBuffer。
//
// Node Buffer 对 <4KB(poolSize >>> 1)的分配共享一块 65536 字节内部池,
// buf.buffer 是**整块池**而非文件字节。直接 return buf.buffer 会让空文件拿到
// 65536 字节全零、小文件夹带池内残留 → 渲染端 TextDecoder 解出 \0 / 垃圾。
//
// 非池化的大文件(≥4KB)本身 byteOffset===0 && byteLength===buffer.byteLength,
// 直接返回原 buffer 省一次全量复制(500MB design-file 上传 / 归档均走此路径)。
export function toExactArrayBuffer(buf: Buffer): ArrayBuffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf.buffer as ArrayBuffer
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
