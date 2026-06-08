import logging
import json
from .llm import intent_llm
from state import AgentState
from .schema import PageDescription
from .prompt import INTENT_SYSTEM_PROMPT
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

# 强制LLM输出结构化数据
structured_llm = intent_llm.with_structured_output(PageDescription, method="json_mode")

def intent_expansion_node(state: AgentState):
    # 用户需求
    user_input = state.get("messages", "")[-1]

    # intent_audit 审核评审记录
    audit_feedback = state.get("intent_audit_feedback", "")
    
    # intent_audit 意图评审是否通过
    intent_audit_pass = state.get("intent_audit_pass", True)
    
    # 当前意图扩展已经执行了几次
    retry_count = state.get("intent_retry_count", 0)

    # 上一轮的界面蓝图
    page_description = json.dumps(state.get("intent_description", {}), ensure_ascii=False)

    if audit_feedback.strip() and not intent_audit_pass:
        logger.info(f"----- ⚠️ Intent Agent [意图审核存在问题] 进入迭代修复阶段 -----")
        human_content = (
            f"你上一次生成的蓝图未通过审核校验，请务必参考以下反馈进行迭代修复：\n"
            f"[用户的原始需求:] ==================================\n{user_input}\n\n"
            f"[待修正界面蓝图:] ==================================\n{page_description}\n\n"
            f"[蓝图审核结果:] ==================================\n{audit_feedback}\n\n"
            "请根据评审意见结论修正界面蓝图。"
        )
    else:
        logger.info(f"----- ⚠️ Intent Agent 正在进入首次生成阶段 -----")
        human_content = (
            f"[用户的需求:] ==================================\n{user_input}\n\n"
            "请开始意图扩展。"
        )

    # 构造消息列表：SystemMessage + HumanMessage
    messages = [
        SystemMessage(content=INTENT_SYSTEM_PROMPT),
        HumanMessage(content=human_content)
    ]

    # 用户输入，评审意见，上一次的JSON
    try:
        result = structured_llm.invoke(messages)
        logger.info(f"-----🚀 intent_agent 执行成功 ---")
        # 该属性是首次生成UI的时候使用
        intent_description = result.model_dump()
        # 后续二次修改时，均使用简洁版的意图，并随修改更新
        intent_page = simplify_data(intent_description)
        return {
            # 
            "intent_description": intent_description,
            "intent_page": intent_page,
            "intent_validation": True,
            "intent_retry_count": retry_count + 1,
            "current_step": "intent_expansion"
        }
    
    except Exception as e:
        logger.info(f"--- intent_agent 格式校验失败: {e} ---")
        error_msg = f"系统提示：你的上一次输出未能通过 JSON 格式校验。错误详情如下：\n{str(e)}\n请修正你的输出并重新生成严格符合规范的数据。"
        return {
            "intent_description": {"error": error_msg},
            "intent_validation": False,
            "current_step": "intent_expansion"
        }
    

def simplify_data(complex_data):
    """
    将复杂的 intent_description 数据转换为精简版 intent_page
    """
    # 1. 提取并重命名基础字段
    page_description = complex_data.get("intentAnalysis", "")
    layout_description = complex_data.get("layoutDescription", "")
    
    # 2. 将 sectionDetailList 转为字典，方便按 id 快速查找
    detail_map = {
        detail["id"]: detail 
        for detail in complex_data.get("sectionDetailList", [])
    }
    
    # 3. 重新整理 sections
    new_sections = []
    for section in complex_data.get("sections", []):
        section_id = section.get("id")
        section_name = section.get("name")
        
        # 获取对应的详情信息
        detail = detail_map.get(section_id, {})
        intent = detail.get("intent", "")
        function = detail.get("function", "")
        
        # 构建新的 section 对象
        new_sections.append({
            "id": section_id,
            "name": section_name,
            "intent": intent,
            "function": function
        })
        
    # 4. 构建并返回最终的简单数据结构
    simplified_data = {
        "pageDescription": page_description,
        "layoutDescription": layout_description,
        "sections": new_sections
    }
    
    return simplified_data