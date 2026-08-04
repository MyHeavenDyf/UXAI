// Node Buffer → 可跨 IPC 传输的精确 ArrayBuffer。
//
// buf.buffer 是**底层 ArrayBuffer**,未必等于 buf 这段视图的字节。read-file-buffer 用的是
// node:fs/promises 的 readFile,实测(Node 22)分布如下:
//
//   文件      fs/promises.readFile(生产路径)     fs.readFileSync(对照)
//   0B        off=0 len=0     buf=65536         off=0   len=0     buf=0
//   2B        off=0 len=2     buf=2             off=288 len=2     buf=8192
//   4095B     off=0 len=4095  buf=4095          off=368 len=4095  buf=8192
//   100KB     off=0 len=102400 buf=102400       off=0   len=102400 buf=102400
//
// 即:**非空文件在生产路径下本来就是精确的**(off=0 且占满 buffer),直接返回原引用零复制
// (500MB design-file 上传 / 归档均走此路径);**只有空文件是坑** —— stat 报 size=0 时 readFile
// 改走「未知大小」的分块读取,末尾 subarray(0,0),于是 len=0 而 buffer 是 65536 的读缓冲
// (kReadFileBufferLength,64KB)。直接 return buf.buffer 就把这 64KB 全零丢给渲染端 →
// TextDecoder 解出 65536 个 \0 → Vditor/Lute 解析卡死主线程,即本次 bug 的成因。
//
// 注意这跟 Buffer 的内部池(Buffer.poolSize=8192,对 <4KB 分配复用、byteOffset 非 0)**不是一回事**:
// fs/promises.readFile 不走池,readFileSync 才走。本函数按视图区间切,两种来源一并覆盖。
export function toExactArrayBuffer(buf: Buffer): ArrayBuffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf.buffer as ArrayBuffer
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
