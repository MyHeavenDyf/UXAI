import type { JSX } from "solid-js"
import type { ArtifactFileKind } from "../utils/artifact-file-api"

import excelUrl from "./Excel.svg"
import mdUrl from "./MD.svg"
import pdfUrl from "./PDF.svg"
import codeUrl from "./code.svg"
import folderUrl from "./folder.svg"
import htmlUrl from "./html.svg"
import imgUrl from "./img.svg"
import mindMapUrl from "./mindMap.svg"
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

export const IconFileFolder = mkFileIcon(folderUrl)
export const IconFileHtml = mkFileIcon(htmlUrl)
export const IconFileImage = mkFileIcon(imgUrl)
export const IconFileVideo = mkFileIcon(videoUrl)
export const IconFileMarkdown = mkFileIcon(mdUrl)
export const IconFileCode = mkFileIcon(codeUrl)
export const IconFilePdf = mkFileIcon(pdfUrl)
export const IconFileSvg = mkFileIcon(mindMapUrl)
export const IconFileOther = mkFileIcon(otherUrl)
const IconFileExcel = mkFileIcon(excelUrl)
const IconFilePpt = mkFileIcon(pptUrl)
const IconFileWord = mkFileIcon(wordUrl)

function pickDocumentIcon(name: string): FileIconComponent {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "xlsx" || ext === "xls") return IconFileExcel
  if (ext === "pptx" || ext === "ppt") return IconFilePpt
  return IconFileWord
}

type KindIconResolver = (name: string) => FileIconComponent

const kindIconMap: Record<ArtifactFileKind, KindIconResolver> = {
  folder: () => IconFileFolder,
  html: () => IconFileHtml,
  image: () => IconFileImage,
  video: () => IconFileVideo,
  markdown: () => IconFileMarkdown,
  code: () => IconFileCode,
  pdf: () => IconFilePdf,
  svg: () => IconFileOther,
  document: pickDocumentIcon,
  audio: () => IconFileOther,
  text: () => IconFileOther,
  binary: () => IconFileOther,
}

export function getFileIcon(kind: ArtifactFileKind, fileName: string): FileIconComponent {
  return kindIconMap[kind](fileName)
}
