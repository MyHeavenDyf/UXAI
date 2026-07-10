import { isArray } from './util';

// y轴处理
function handleyAxis(chartOption) {
  const yAxis = {};
  let chartyAxis = isArray(chartOption.yAxis) ? chartOption.yAxis[0] : chartOption.yAxis;
  if (chartyAxis) {
    if (chartyAxis.data) {
      chartyAxis = chartOption.xAxis;
    }
    // 保留HUI需要处理的key
    const keysToKeep = ['max', 'min', 'interval', 'position', 'name', 'minInterval', 'maxInterval', 'splitLine'];
    keysToKeep.forEach(key => {
      if (chartyAxis.hasOwnProperty(key)) {
        yAxis[key] = chartyAxis[key];
      }
    });
    if (chartyAxis.axisLabel) {
      yAxis.labelTextStyle = chartyAxis.axisLabel;
    }
    if (!yAxis.name && chartOption.title && chartOption.title.text) {
      yAxis.name = chartOption.title.text;
    }
    return yAxis;
  } else {
    return false;
  }
}

export default handleyAxis;
