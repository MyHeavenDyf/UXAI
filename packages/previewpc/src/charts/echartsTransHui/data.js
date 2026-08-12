import { isArray } from './util';

// 数据转换
function handleData(chartOption) {
  const chartSeries = chartOption.series;
  const chartxAxis = isArray(chartOption.xAxis) ? chartOption.xAxis[0] : chartOption.xAxis;
  const chartyAxis = isArray(chartOption.yAxis) ? chartOption.yAxis[0] : chartOption.yAxis;
  const xAxisData = chartxAxis?.data || chartyAxis?.data;
  const huiData = [];
  let type;
  // 有X轴系列的图表
  const hasxAxisType = ['bar', 'line'];
  // 无X轴系列的图表
  const dataValueType = ['pie'];
  if (isArray(chartSeries)) {
    const dataArr = [];
    type = chartSeries[0].type;
    if (hasxAxisType.indexOf(type) !== -1) {
      chartSeries.forEach((item, index) => {
        const name = item.name ? item.name : `dataName${index}`;
        const chartData = item.data;
        const itemData = chartData.map(item => {
          return { [name]: item };
        });
        dataArr.push(itemData);
      });
      if (xAxisData) {
        xAxisData.forEach((item, index) => {
          const obj = { Name: item };
          dataArr.forEach(child => {
            Object.assign(obj, child[index]);
          });
          huiData.push(obj);
        });
      } else {
        dataArr[0].forEach(child => {
          const obj = { Name: '' };
          huiData.push(Object.assign(obj, child));
        });
      }
    }
    if (dataValueType.indexOf(type) !== -1) {
      const { data } = chartSeries[0];
      data.forEach(item => {
        huiData.push({
          value: item.value,
          name: item.name,
        });
      });
    }
  } else {
    const name = chartSeries.name ? chartSeries.name : 'dataName';
    const chartData = chartSeries.data;
    type = chartSeries.type;
    xAxisData.forEach((item, index) => {
      huiData.push({
        xAxisLabel: item,
        [name]: chartData[index],
      });
    });
  }
  return {
    type,
    data: huiData,
  };
}

export default handleData;
