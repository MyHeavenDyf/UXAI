现在补充下icon的向量库调用逻辑 1、首先调用 https://octo-beta.hdesign.huawei.com/iconPlus/getConfig  这个接口会响应json 
{ 	“size”: [{ “key”: 16, “value”: 16},{ “key”: 24, “value”: 24},{ “key”: 36, “value”: 36},{ “key”: 48, “value”: 48 }],
	“style”：[{ “key”: “line”, “value”: “线性” },{ “key”: “filled”, “value”: “面性” }],
	“category”：[{ “key”: “basic”, “value”: “基础图标” },{ “key”: “system”, “value”: “系统图标” }],
	“color”：[{ “id”: “GTS_线程_Blue-5”, “key”: “Blue-5”,  “value”: “#007DFF”，“domain”: “GTS”, “type”:”linear”, “style”:”线性”}],
}  能拿到相应的配置数据 
2、然后我们根据相应的关键词搜索匹配的向量数据库
接口为 
https://octo-beta.hdesign.huawei.com/iconPlus/getIconInfo

get接口
三个参数

keyword 必选 搜索关键词
topK 非必选 关键词返回数量，默认5
Category 非必选 图标类别 一般不填写


会响应一个json 

[{
	“keyword”: “下载”,
	“icons”: [{
		“icon_id”: “123”,
		“name”: “下载”,
		“chineseName”: “中文”,
		“enlishName”: “英文”,
		“description”: “”,
		“category”: “基础图标”,
		“group”:”通用”,
		“score”:”0.95”
	}]
}]
 需要根据不同的score，我们匹配到最合适的内容 
3、最后再通过这两个进行匹配，调用 https://octo-beta.hdesign.huawei.com/iconPlus/getSvg

它有五个参数
icon_id 必选 是上一个接口获取到的icon_id
size 必选 是图标尺寸
style 必选 配置的是线性还是面性
color 必选 配置的最合适的颜色
fileType 非必选 svg 还是png格式

会响应个

如果是svg， 会返回svg标签
如果是png， 会返回base64