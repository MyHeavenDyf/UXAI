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
      description: "界面大区域划分列表，包含详细结构和数据",
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
            description: "该区域的意图、目的和包含的功能描述"
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
            type: "object",
            description: "局部 JSON 数据契约：驱动该区块渲染的 JSON 结构，必须包含丰富的高拟真业务 Mock 数据。如果该区域使用了模块模板则不生成此字段"
          },
          patternPath: {
            type: "string",
            description: "可选字段，仅当该区域使用了用户选定的模块模板时填写，值为模板文件路径"
          }
        },
        required: ["id", "name", "description", "layout", "elements"]
      }
    }
  },
  required: ["userInput", "intentAnalysis", "layoutDescription", "sections"]
};

export default intentDescriptionSchema;
