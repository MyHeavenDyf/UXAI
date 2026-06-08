from pydantic import BaseModel, Field

class IntentAuditResult(BaseModel):
    is_pass: bool = Field(description="是否完全覆盖了用户的原始需求？如果全部覆盖返回 True；如果有任何遗漏（例如少列了数据列、漏掉了按钮或特定布局要求），返回 False。")
    feedback: str = Field(description="如果 is_pass 为 False，请明确指出意图蓝图中遗漏了用户的哪些具体要求。如果通过，请回复 '需求完全覆盖'。")