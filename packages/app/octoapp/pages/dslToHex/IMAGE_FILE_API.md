现在补充下icon的向量库调用逻辑1、首先调用 https://octo-beta.hdesign.huawei.com/assetRepository/imagePlus/getConfig
这个接口会响应json 
{	
    "group": [{
        "id": 104,
        "key": "H Design",
        "value": "H Design",
        "children": [{
            "id":109,
            "key": "生活",
            "value": "生活"
        }, {
            "id":112,
            "key": "医疗",
            "value": "医疗"
        }],
    }]
}

2、第二步，搜索插画信息

2、然后我们根据相应的关键词搜索匹配的向量数据库
接口为 
https://octo-beta.hdesign.huawei.com/assetRepository/imagePlus/getImageInfo

get接口
三个参数

keyword 必选 搜索关键词
topK 非必选 关键词返回数量，默认5
source_id 非必选 来源id 默认不填写
group_id 非必选 分组id 从getConfig里获取到的groups获取最合适的


会响应一个json 

[{
	“keyword”: “下载”,
	"images": [{
		“image_id”: “123”,
		“alias”: “下载”,
		“description”: “”,
		“category”: “基础图标”,
		“tags”:”办公”,
        “theme”: “浅色”，
        “version”: "1.0.0",
        “group”: "h design",
        “url”: "https://...",
		“score”:”0.95”
	}]
}]

需要根据不同的score，我们匹配到最合适的内容
3、最后再通过这两个进行匹配，调用https://octo-beta.hdesign.huawei.com/assetRepository/imagePlus/getImage

它有三个参数
url 必选 是上一个接口获取到的url，支持逗号隔开分批获取
theme 非必选 主题参数
fileType 非必选 默认 svg 还是png格式

单个响应

{
    url: "https://...",
    name: "女性"，
    format: "jpg",
    data： “<svg></svg>” // jpg | png的话是base64
}

多个响应
[{
    image_id: "https://...",
    name: "女性"，
    format: "jpg",
    data： “<svg></svg>”  // jpg |  png的话是base64
}]