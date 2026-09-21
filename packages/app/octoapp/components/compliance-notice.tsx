import { type JSX } from "solid-js"
import { usePlatform } from "@/context/platform"
import "./compliance-notice.css"

const AI_MANAGEMENT_GUIDE_URL = "https://w3.huawei.com/info/cn/doc/viewDoc.do?did=18822293&cata348041"

function ComplianceGuideLink(props: { children: JSX.Element }): JSX.Element {
  const platform = usePlatform()
  return (
    <a
      href={AI_MANAGEMENT_GUIDE_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="compliance-notice-link"
      onClick={(event) => {
        event.preventDefault()
        platform.openLink(AI_MANAGEMENT_GUIDE_URL)
      }}
    >
      {props.children}
    </a>
  )
}

/**
 * 外网模型合规提示：显示在输入框底部，与 studio 页面一致的
 * 「遵守 [合规指引]，严禁上传内部敏感信息」样式（hover 展开指引全文）。
 */
export function ComplianceNotice(): JSX.Element {
  return (
    <div class="compliance-notice">
      <span>遵守</span>
      <div class="compliance-notice-guide">
        <button type="button" class="compliance-notice-trigger">合规指引</button>
        <span>，</span>
        <div role="tooltip" class="compliance-notice-tooltip">
          <div class="compliance-notice-tooltip-content">
            请遵守
            <ComplianceGuideLink>《业务生产与办公生成式人工智能管理指引》</ComplianceGuideLink>
            ，按公司要求不能向外部网站上传内部文档、内部代码及内部信息。
          </div>
        </div>
      </div>
      <span>严禁上传内部敏感信息</span>
    </div>
  )
}
