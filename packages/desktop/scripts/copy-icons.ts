import { $ } from "bun"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = `./icons/${channel}`
const dest = "resources/icons"

// 源目录不完整时立即报错:cp -R 会静默拷贝缺失目录并"成功",
// 产物表现为打包态 dock 图标加载为空,必须在校验层拦下
for (const name of ["icon.icns", "icon.png", "icon.ico", "dock.png", "dock-dark.png", "dock-light.png"]) {
  if (!(await Bun.file(`${src}/${name}`).exists())) {
    throw new Error(`icons/${channel}/${name} 缺失:图标源目录不完整,拒绝生成 resources/icons`)
  }
}

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
