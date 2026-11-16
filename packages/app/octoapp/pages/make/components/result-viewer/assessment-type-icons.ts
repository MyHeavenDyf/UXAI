/** 评审类型子类 → 图标映射 */
import colorPalette from "../../icons/ic_public_color_palette.svg"
import titleCharacter from "../../icons/title_character.svg"
import waypointDistance from "../../icons/waypoint_distance.svg"
import starCard from "../../icons/star_card.svg"
import gifDoc from "../../icons/gif_doc.svg"
import serviceCard from "../../icons/service_card.svg"
import aiArea from "../../icons/AI_area.svg"
import layoutUpDown from "../../icons/layout_up_down.svg"
import textClipboard from "../../icons/text_clipboard.svg"
import rectangleGroup from "../../icons/rectangle_3_group_1.svg"
import docPlaintext from "../../icons/doc_plaintext.svg"
import textBoundless from "../../icons/text_boundless.svg"
import rectangleOnSquare from "../../icons/rectangle_on_square.svg"

const ICON_BY_SUBTYPE: Record<string, string> = {
  "颜色": colorPalette,
  "字体": titleCharacter,
  "间距与尺寸": waypointDistance,
  "边框/圆角/阴影": starCard,
  "Token有效性": gifDoc,
  "页面骨架": serviceCard,
  "核心 Block": aiArea,
  "基础控件": layoutUpDown,
  "规范可追溯性": textClipboard,
  "页面结构": rectangleGroup,
  "业务内容": docPlaintext,
  "可见渲染": textBoundless,
  "构建交付": rectangleOnSquare,
}

export function assessmentTypeIcon(subtype: string): string | undefined {
  return ICON_BY_SUBTYPE[subtype]
}
