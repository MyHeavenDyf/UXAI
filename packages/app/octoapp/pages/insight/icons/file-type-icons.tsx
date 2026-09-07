// 文件类型图标:对齐 Design 模块(make/icons/file-type-icons.tsx)的 SVG 图标集,
// 按 InsightFileKind 取图标(Insight 的 kind 已按扩展名细分 office 类型,无需再按 name 二次挑选)。
// insight 自包含:SVG 与本文件均拷贝自 make/icons,不 import make 目录。

import type { JSX } from "solid-js"
import type { InsightFileKind } from "../utils/insight-file-api"

import excelUrl from "./Excel.svg"
import mdUrl from "./MD.svg"
import pdfUrl from "./PDF.svg"
import codeUrl from "./code.svg"
import folderUrl from "./folder.svg"
import htmlUrl from "./html.svg"
import imgUrl from "./img.svg"
import otherUrl from "./other.svg"
import pptUrl from "./ppt.svg"
import videoUrl from "./video.svg"
import wordUrl from "./word.svg"

type FileIconProps = { size?: number; style?: JSX.CSSProperties }
type FileIconComponent = (props?: FileIconProps) => JSX.Element

function mkFileIcon(src: string): FileIconComponent {
  return function Icon(props?: FileIconProps): JSX.Element {
    const size = props?.size ?? 32
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        style={{ "flex-shrink": "0", display: "inline-block", ...(props?.style ?? {}) }}
      />
    )
  }
}

const IconFileFolder = mkFileIcon(folderUrl)
const IconFileHtml = mkFileIcon(htmlUrl)
const IconFileImage = mkFileIcon(imgUrl)
const IconFileVideo = mkFileIcon(videoUrl)
const IconFileMarkdown = mkFileIcon(mdUrl)
const IconFileCode = mkFileIcon(codeUrl)
const IconFilePdf = mkFileIcon(pdfUrl)
const IconFileOther = mkFileIcon(otherUrl)
const IconFileExcel = mkFileIcon(excelUrl)
const IconFilePpt = mkFileIcon(pptUrl)
const IconFileWord = mkFileIcon(wordUrl)

const kindIconMap: Record<InsightFileKind, FileIconComponent> = {
  folder: IconFileFolder,
  html: IconFileHtml,
  markdown: IconFileMarkdown,
  json: IconFileCode,
  image: IconFileImage,
  pdf: IconFilePdf,
  word: IconFileWord,
  ppt: IconFilePpt,
  excel: IconFileExcel,
  code: IconFileCode,
  text: IconFileOther,
  video: IconFileVideo,
  other: IconFileOther,
}

export function getFileIcon(kind: InsightFileKind): FileIconComponent {
  return kindIconMap[kind]
}
