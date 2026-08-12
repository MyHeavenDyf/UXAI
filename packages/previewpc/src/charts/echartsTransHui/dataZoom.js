import { isArray } from './util';

// datazoom处理
function handleDataZoom(chartOption) {
  const dataZoom = {};
  const chartDataZoom = isArray(chartOption.dataZoom) ? chartOption.dataZoom[0] : chartOption.dataZoom;
  if (chartDataZoom && chartDataZoom.show) {
    // 保留HUI需要处理的key
    const keysToKeep = ['start', 'end'];
    keysToKeep.forEach(key => {
      if (chartDataZoom.hasOwnProperty(key)) {
        dataZoom[key] = chartDataZoom[key];
      }
    });
    if (chartDataZoom) {
      dataZoom.show = true;
    }
    dataZoom.position = {
      left: 36,
      bottom: 20,
    };
  }
  return dataZoom;
}

export default handleDataZoom;
