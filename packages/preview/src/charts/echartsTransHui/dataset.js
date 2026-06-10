// 数组去重
function unique(arr) {
    const map = new Map();
    return arr.filter((item) => !map.has(item) && map.set(item, 1));
}

// 数据转换
function handleDataSet(chartOption) {
	const dataset = chartOption.dataset;
	const source = dataset.source;
	const series = chartOption.series;
	// 无X轴系列的图表
	const dataValueType = ['pie'];
	const lineOption = {};
	const barOption = {};
	let hasPie = false;
	let typeArr = [];
	let chartType;
	series.forEach((item) => {
		let type = item.type;
		if (dataValueType.indexOf(type) !== -1) {
			hasPie = true;
		}
		typeArr.push(type);
	});
	typeArr = unique(typeArr);
	let huiData = [];
	let nameKey, dataKey;
	// 饼图特殊处理
	if (hasPie) {
		const encode = series[0].encode;
		dataKey = encode.value;
		nameKey = encode.itemName || encode.name;
		source.forEach(item => {
			huiData.push({
				value: item[dataKey],
				name: item[nameKey]
			})
		})
		chartType = 'pie';
	} else {
		const xAxis = chartOption.xAxis;
		const direction = xAxis.type == 'category' ? 'vertical' : 'horizontal';
		nameKey = direction == 'vertical' ? series[0].encode.x : series[0].encode.y;
		if (typeArr.length == 1) {
			chartType = typeArr[0];
			huiData = source;
		} else {
			chartType = 'barLine';
			huiData = source;
			lineOption.dataName = [];
			barOption.dataName = [];
			series.forEach((item) => {
				if (item.type == 'bar') {
					barOption.dataName.push(
						direction == 'vertical' ? item.encode.y : item.encode.x
					);
				}
				if (item.type == 'line') {
					lineOption.dataName.push(
						direction == 'vertical' ? item.encode.y : item.encode.x
					);
				}
			});
		}
	}
	return {
		type: chartType,
		data: huiData,
		xName: nameKey,
		barOption: barOption,
		lineOption: lineOption,
	};
}

export default handleDataSet;
