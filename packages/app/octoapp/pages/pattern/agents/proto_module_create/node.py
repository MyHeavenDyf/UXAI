import re
import json
import logging
from datetime import datetime, timezone
from .llm import module_llm
from .tool import load_components_docs
from .prompt import MODULE_SYSTEM_PROMPT
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, ToolMessage
from utils.output import json_output_sync

logger = logging.getLogger(__name__)

module_agent = create_react_agent(
    model=module_llm,
    tools=[load_components_docs],
    prompt=MODULE_SYSTEM_PROMPT,
)

def module_create_node(state: dict):
    # 该模块所属的 section_id 
    section_id = state.get("section_id", {})
    # 该模块父容器 element_id
    element_id = state.get("element_id", {})
    # 该模块内部元素id前缀 id_prefix
    id_prefix = state.get("id_prefix", {})

    # 拓展意图
    intent_description = state.get("intent_description", {})
    user_input = intent_description.get("userInput", "未提供")
    intent_analysis = intent_description.get("intentAnalysis", "")
    intent_analysis += intent_description.get("pageDescription", "")
    layout_desc = intent_description.get("layoutDescription", "未提供")

    sections = intent_description.get("sections", [])
    sections_str = json.dumps(sections, indent=2, ensure_ascii=False)
    
    # 布局规划
    layout_planner = state.get("layout_planner", {})
    elements = layout_planner.get("elements", [])
    slot_element = next((e for e in elements if e.get("id") == element_id), {})
    slot_element_str = json.dumps(slot_element, indent=2, ensure_ascii=False)
    
    # 该模块详细意图
    section_detail_list = intent_description.get("sectionDetailList", [])
    sectionDetail = next((item for item in section_detail_list if item.get("id") == section_id), {})
    sectionDetail_str = json.dumps(sectionDetail, indent=2, ensure_ascii=False)

    # 匹配到的 section 级 pattern（可能为 None）
    matched_pattern = state.get("matched_pattern")

    # 组装最终的高质量 Prompt
    human_prompt = (
        f"请为以下模块生成 A2UI JSON：\n\n"
        
        f"【完整页面蓝图】: ========================\n"
        f"- 用户输入: {user_input}\n"
        f"- 意图分析: {intent_analysis}\n"
        f"- 布局描述: {layout_desc}\n"
        f"- 页面结构: {sections_str}\n\n"
        
        f"【模块顶层容器】: ========================\n"
        f"- Root ID: {element_id}\n"
        f"- Root UI:\n{slot_element_str}\n\n"
        
        f"【需要被渲染的模块详细蓝图】: ========================\n"
        f"{sectionDetail_str}\n\n"
        
        f"【需要被渲染模块的根节点】: {element_id}\n"
        f"【模块内部元素id前缀】: {id_prefix} (注：该模块内所有 element id 必须以此开头)\n\n"
        
        f"请先调用 `load_module_components` 工具查询组件 API，然后生成该模块的 JSON（包含 state 子集和 elements 数组）。"
    )


    # logger.info(f"------ [Node] 执行 Module Generator: {human_prompt} ------")

    result = module_agent.invoke({"messages": [HumanMessage(content=human_prompt)]})

    # 最终AI输出的局部UI的JSON
    final_output = result["messages"][-1].content

    module_json = {}
    try:
        clean_text = final_output.replace("\ufeff", "").replace("\u200b", "").strip()
        match = re.search(r"(\{.*\})", clean_text, re.DOTALL)
        if match:
            module_json = json.loads(match.group(1))
        else:
            module_json = json.loads(clean_text)
        logger.info(f"----- ✅ 模块 [{section_id}] JSON 解析成功！-----")
    except Exception as e:
        logger.error(f"----- ❌ 模块 [{section_id}] JSON 解析失败:: {final_output} -----")
        module_json = {"error": "parse failed", "raw_output": final_output}

    return {
        "module_results": [{
            "ui_json": module_json,
            "section_id": section_id,
            "element_id": element_id,
            "id_prefix": id_prefix,
        }]
    }