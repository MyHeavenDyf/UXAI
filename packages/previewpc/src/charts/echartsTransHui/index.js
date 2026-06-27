
import handleData from './data';
import handleDataSet from './dataset';
import handleLegend from './legend';
import handleGrid from './grid';
import handlexAxis from './xAxis';
import handleyAxis from './yAxis';
import handleDataZoom from './dataZoom';
import handleMarkLine from './markLine';
import handleType from './type';
import { capitalizeFirstLetter } from './util';

// 错误或者不支持的类型直接返回信息
const errorResult = {
  result: false,
  error: 'not_supported_chart',
};
// 目前支持的转换的hui类型
const supportType = ['BarChart', 'LineChart', 'PieChart',' BarLineChart'];

// 转换echartsOption
function transOption(chartOption) {
  // echart配置项为{}、null、undefined直接返回false
  if (chartOption === null || (typeof chartOption === 'object' && Object.keys(chartOption).length === 0)) {
    return errorResult;
  } else {
    // 转换各个模块配置项，报错则返回false
    try {
      const huiChartOption = {};
      let huiData;
      // 转换data
      if(chartOption.dataset) {
        huiData = handleDataSet(chartOption);
      } else {
        huiData = handleData(chartOption);
      }
      huiChartOption.data = huiData.data;
      // 转换datamarkLine
      const markLineOption = handleMarkLine(chartOption);
      if (Object.keys(markLineOption).length) {
        huiChartOption.markLine = markLineOption;
      }
      // 转换X轴
      const xAxisOption = handlexAxis(chartOption);
      if (xAxisOption) {
        huiChartOption.xAxis = xAxisOption;
      }
      if(chartOption.dataset && huiChartOption.xAxis) {
        huiChartOption.xAxis.data = huiData.xName;
      }
      // 转换Y轴
      const yAxisOption = handleyAxis(chartOption);
      if (yAxisOption) {
        huiChartOption.yAxis = yAxisOption;
      }
      // 转换DataZoom
      const dataZoomOption = handleDataZoom(chartOption);
      if (dataZoomOption && dataZoomOption.show !== false) {
        huiChartOption.dataZoom = dataZoomOption;
      }
      // 转换Grid
      if (handleGrid(chartOption).length) {
        huiChartOption.padding = handleGrid(chartOption);
      }
      // 获取huiCharts图表类型
      const type = `${capitalizeFirstLetter(huiData.type)}Chart`;
      // 转换legend
      huiChartOption.legend = handleLegend(chartOption, type);
      // 根据图表类型，转换图表特有配置项
      handleType(type, chartOption, huiChartOption);
			// 折柱类型
			if (type == 'BarLineChart') {
				huiChartOption.barOption = huiData.barOption;
				huiChartOption.lineOption = huiData.lineOption;
			}
      // 是否在支持的类型里面
      if (supportType.indexOf(type) === -1) {
        return errorResult;
      } else {
        return {
          result: true,
          type,
          option: huiChartOption,
        };
      }
    } catch (error) {
      console.log('error', error);
      return errorResult;
    }
  }
}

export default transOption;
