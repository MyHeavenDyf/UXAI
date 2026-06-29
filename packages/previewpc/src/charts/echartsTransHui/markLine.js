import { isArray } from './util';

// x轴处理
function handleMarkLine(chartOption) {
  let chartSeries = chartOption.series;
  const markLine = {};
  if (isArray(chartSeries)) {
    chartSeries = chartOption.series[0];
  }
  const chartMarkLine = chartSeries.markLine;
  if (chartMarkLine && chartMarkLine.data) {
    const chartMarkLineData = chartMarkLine.data;
    chartMarkLineData.forEach((item, index) => {
      if (index === 0) {
        const { label } = item;
        const { lineStyle } = item;
        const { yAxis } = item;
        if (yAxis !== undefined) {
          markLine.top = yAxis;
        }
        if (label) {
          if (label.formatter) {
            markLine.topLabel = label.formatter;
          }
          if (label.position) {
            markLine.topPosition = label.position;
          }
        }
        if (lineStyle) {
          if (lineStyle.color) {
            markLine.topColor = lineStyle.color;
          }
        }
      }
      if (index === 1) {
        const { label } = item;
        const { lineStyle } = item;
        const { yAxis } = item;
        if (yAxis !== undefined) {
          markLine.bottom = yAxis;
        }
        if (label) {
          if (label.formatter) {
            markLine.bottomLabel = label.formatter;
          }
          if (label.position) {
            markLine.bottomPosition = label.position;
          }
        }
        if (lineStyle) {
          if (lineStyle.color) {
            markLine.bottomColor = lineStyle.color;
          }
        }
      }
    });
  }
  return markLine;
}

export default handleMarkLine;
