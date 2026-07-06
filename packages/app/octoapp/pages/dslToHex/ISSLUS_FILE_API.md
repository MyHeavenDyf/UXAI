现在补充下icon的向量库调用逻辑1、首先调用 https://octo-beta.hdesign.huawei.com/illusPlus/getConfig
这个接口会响应json 
{	
    "category": {
        "key": "H Design",
        "value": "H Design",
        "theme": [{
            "key": "light",
            "value": "浅色"
        }, {
            "key": "dark",
            "value": "深色"
        }]
    }
}

2、第二步，搜索插画信息

2、然后我们根据相应的关键词搜索匹配的向量数据库
接口为 
https://octo-beta.hdesign.huawei.com/illusPlus/getIllusInfo

get接口
三个参数

keyword 必选 搜索关键词
topK 非必选 关键词返回数量，默认5
Category 非必选 图标类别 一般不填写


会响应一个json 

[{
	“keyword”: “下载”,
	“illus”: [{
		“illus_id”: “123”,
		“alias”: “下载”,
		“description”: “”,
		“category”: “基础图标”,
		“tags”:”办公”,
        “theme”: “浅色”，
        “verison”: "1.0.0"
		“score”:”0.95”
	}]
}]

需要根据不同的score，我们匹配到最合适的内容
3、最后再通过这两个进行匹配，调用https://octo-beta.hdesign.huawei.com/illusPlus/getIllus

它有三个参数
illus_id 必选 是上一个接口获取到的illus_id，支持逗号隔开分批获取
theme 非必选 主题参数
fileType 非必选 默认 svg 还是png格式

如果是单个 会响应个

如果是svg， 会返回svg标签
如果是png， 会返回base64

多个是会响应
[{
    illus_id: "123",
    alias: "女性"，
    data： “<svg></svg>”
}]