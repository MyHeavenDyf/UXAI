const intentDescriptionSchema = {
  type: "object",
  properties: {
    userInput: {
      type: "string",
      description: "用户的原始自然语言描述需求"
    },
    intentAnalysis: {
      type: "string",
      description: "业务意图分析：包含业务领域、用户角色以及页面的核心工作流"
    },
    layoutDescription: {
      type: "string",
      description: "详细描述界面的布局模式(如：顶部导航+左侧边栏+右主体区域等等)"
    },
    sections: {
      type: "array",
      description: "界面大区域划分列表",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "子区域的唯一标识 id"
          },
          name: {
            type: "string",
            description: "子区域名称，例如：核心指标看板区"
          },
          description: {
            type: "string",
            description: "子区域描述：描述该区块的功能，解决什么具体业务问题"
          }
        },
        required: ["id", "name", "description"]
      }
    },
    sectionDetailList: {
      type: "array",
      description: "所有区域的详细结构和数据扩充",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "子区域的唯一标识 id, 对应主体布局结构（sections）的区块id"
          },
          name: {
            type: "string",
            description: "子区域名称，对应主体布局结构的区块名称，例如：4.1 核心指标看板区"
          },
          intent: {
            type: "string",
            description: "该区域的意图和目的, 为了解决什么具体业务问题"
          },
          function: {
            type: "string",
            description: "该区域包含的功能"
          },
          layout: {
            type: "string",
            description: "该区域的结构布局描述，包括对外的结构布局策略，和内部的结构布局策略"
          },
          elements: {
            type: "string",
            description: "该区域拥有的子模块描述, 清晰说明采用什么组件"
          },
          data: {
            type: "object", // 对应 Python 的 Dict[str, Any]
            description: "局部 JSON 数据契约：驱动该区块渲染的 JSON 结构，必须包含丰富的高拟真业务 Mock 数据"
          }
        },
        required: ["id", "name", "intent", "function", "layout", "elements", "data"]
      }
    }
  },
  required: ["userInput", "intentAnalysis", "layoutDescription", "sections", "sectionDetailList"]
};

export default intentDescriptionSchema;