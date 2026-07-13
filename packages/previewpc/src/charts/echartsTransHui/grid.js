// grid转换
function handleGrid(chartOption) {
	// 默认padding间距
	let padding = [50, 30, 50, 20];
	// 检测是否为数字或者百分比
	function isNumberOrPercentage(str) {
		const num = parseFloat(str);
		return !isNaN(num);
	}
	if (chartOption.grid) {
		if (isNumberOrPercentage(chartOption.grid.top)) {
			padding[0] = chartOption.grid.top;
		}
		if (isNumberOrPercentage(chartOption.grid.right)) {
			padding[1] = chartOption.grid.right;
		}
		if (isNumberOrPercentage(chartOption.grid.bottom)) {
			padding[2] = chartOption.grid.bottom
		}
		if (isNumberOrPercentage(chartOption.grid.left)) {
			padding[3] = chartOption.grid.left
		}
	}

	return padding;
}

export default handleGrid;