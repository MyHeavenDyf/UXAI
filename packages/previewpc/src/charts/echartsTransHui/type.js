import { isArray } from './util';
import { getTextWidth } from './util';

// 处理各种类型图表独有数据
function handleType(type, chartOption, huiChartOption) {
  if (type === 'LineChart') {
    let chartSeries = chartOption.series;
    if (isArray(chartSeries)) {
      chartSeries = chartOption.series[0];
    }
    if (chartSeries.smooth !== undefined) {
      huiChartOption.smooth = chartSeries.smooth;
    }
    if (chartSeries.step !== undefined) {
      huiChartOption.step = chartSeries.step;
    }
    if (chartSeries.stack && chartSeries.stack === 'Total') {
      huiChartOption.stack = true;
    }
  }
  if (type === 'BarChart') {
    let chartSeries = chartOption.series;
    let dataset = chartOption.dataset;
    if (isArray(chartSeries)) {
      chartSeries = chartOption.series[0];
    }
    if (chartSeries.barMinHeight !== undefined) {
      huiChartOption.itemStyle = huiChartOption.itemStyle ? huiChartOption.itemStyle : {};
      huiChartOption.itemStyle.barMinHeight = chartSeries.barMinHeight;
    }
    if (chartSeries.stack) {
      huiChartOption.type = 'stack';
    }
    if (chartOption?.yAxis?.data || chartOption?.dataset) {
      huiChartOption.direction = 'horizontal';
      if(dataset) {
        huiChartOption.direction = chartOption.yAxis.type == 'value' ? 'vertical' : 'horizontal';
        if(huiChartOption.direction == 'horizontal') {
					let xAxisName = huiChartOption?.xAxis?.name;
					let yAxisName = huiChartOption?.yAxis?.name;
					if(yAxisName) {
						huiChartOption.xAxis.name = yAxisName;
					} else {
						delete huiChartOption.xAxis?.name;
					}
					if(xAxisName) {
						huiChartOption.yAxis.name = xAxisName;
					} else {
						delete huiChartOption.yAxis?.name;
					}
        }
      }
      if(JSON.stringify(huiChartOption.padding) == JSON.stringify([50, 30, 50, 20])){
        // 柱状图横向默认padding值
        let name = huiChartOption?.yAxis?.name;
        if(dataset && huiChartOption.direction== 'vertical') {
          name = huiChartOption?.xAxis?.name;
        }
        let rightPadding = 80;
        if (name) {
          rightPadding = getTextWidth(name, 12) + 50;
        }
        huiChartOption.padding = [50, rightPadding, 50, 20];
      }
    }
    if (chartSeries.label && chartSeries.label.show) {
      // 根据不同柱状图类型配置柱状图label选项
      if (huiChartOption.direction === 'horizontal' && huiChartOption.type !== 'stack') {
        huiChartOption.label = {
          show: true,
          position: 'right',
          offset: [6, 0],
        };
      } else if (huiChartOption.type === 'stack' && huiChartOption.direction !== 'horizontal') {
        huiChartOption.label = {
          show: true,
          position: 'inside',
          offset: [0, 0],
        };
      } else if (huiChartOption.type === 'stack' && huiChartOption.direction === 'horizontal') {
        huiChartOption.label = {
          show: true,
          position: 'inside',
          offset: [0, -16],
        };
      } else {
        huiChartOption.label = {
          show: true,
          position: 'top',
          offset: [0, -6],
        };
      }
    }
  }
  if (type === 'PieChart') {
    let chartSeries = chartOption.series;
    if (isArray(chartSeries)) {
      chartSeries = chartOption.series[0];
    }
    if (chartSeries.roseType !== undefined) {
      huiChartOption.roseType = chartSeries.roseType;
    }
    if (chartSeries.label) {
			huiChartOption.label = huiChartOption.label ? huiChartOption.label : {};
			if (chartSeries.label.show !== undefined) {
				huiChartOption.label.show = chartSeries.label.show;
			}
    }
		if (chartSeries.labelLine) {
			huiChartOption.label = huiChartOption.label ? huiChartOption.label : {};
			if (chartSeries.labelLine.show !== undefined) {
				huiChartOption.label.line = chartSeries.labelLine.show;
			}
    }
    if (chartSeries.selectedMode) {
      huiChartOption.selectedMode = chartSeries.selectedMode;
    }
    huiChartOption.type = 'pie';
    if ((chartSeries.radius && !isArray(chartSeries.radius)) || (isArray(chartSeries.radius) && chartSeries.radius.length === 1)) {
      huiChartOption.type = 'pie';
    }
    if ((isArray(chartSeries.radius) && chartSeries.radius.length === 2)) {
      huiChartOption.type = 'circle';
    }
    if (chartSeries.minAngle !== undefined) {
      huiChartOption.minAngle = chartSeries.minAngle;
    }
    if (chartSeries.title) {
      huiChartOption.title = chartSeries.title;
    }
  }
}

export default handleType;
