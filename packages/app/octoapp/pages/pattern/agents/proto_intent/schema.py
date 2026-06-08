from pydantic import BaseModel, Field
from typing import List, Dict, Any

class SectionDetail(BaseModel):
    """子结构扩展模块 (对应每一个具体的 UI 区块)"""
    id: str = Field(
        description="子区域的唯一标识 id, 对应主体布局结构（sections）的区块id"
    )
    name: str = Field(
        description="子区域名称，对应主体布局结构的区块名称，例如：4.1 核心指标看板区"
    )
    intent: str = Field(
        description="该区域的意图和目的, 为了解决什么具体业务问题"
    )
    function: str = Field(
        description="该区域包含的功能"
    )
    layout: str = Field(
        description="该区域的结构布局描述，包括对外的结构布局策略，和内部的结构布局策略"
    )
    elements: str = Field(
        description="该区域拥有的子模块描述, 清晰说明采用什么组件"
    )
    data: Dict[str, Any] = Field(
        description="局部 JSON 数据契约：驱动该区块渲染的 JSON 结构，必须包含丰富的高拟真的业务 Mock 数据"
    )

class Section(BaseModel):
    """子结构扩展模块 (对应每一个具体的 UI 区块)"""
    id: str = Field(
        description="子区域的唯一标识 id"
    )
    name: str = Field(
        description="子区域名称，例如：核心指标看板区"
    )
    description: str = Field(
        description="子区域描述：描述该区块的功能，解决什么具体业务问题"
    )

class PageDescription(BaseModel):
    """整个页面的全局意图与结构蓝图"""
    userInput: str = Field(
        description="用户的原始自然语言描述需求"
    )
    intentAnalysis: str = Field(
        description="业务意图分析：包含业务领域、用户角色以及页面的核心工作流"
    )
    layoutDescription: str = Field(
        description="详细描述界面的布局模式(如：顶部导航+左侧边栏+右主体区域等等)"
    )
    sections: List[Section] = Field(
        description="界面大区域划分列表"
    )
    sectionDetailList: List[SectionDetail] = Field(
        description="所有区域的详细结构和数据扩充"
    )