import { isArray } from './util';

// x轴处理
function handlexAxis(chartOption) {
  const xAxis = {};
  let chartxAxis = isArray(chartOption.xAxis) ? chartOption.xAxis[0] : chartOption.xAxis;

  if (chartxAxis) {
    if (!chartxAxis.data && chartOption.yAxis && chartOption.yAxis.data) {
      chartxAxis = chartOption.yAxis;
    }
    if (chartxAxis.name) {
      xAxis.name = chartxAxis.name;
    }
    const chartxAxisLabel = chartxAxis.axisLabel;

    if (chartxAxisLabel) {
      if (chartxAxisLabel.interval) {
        xAxis.interval = chartxAxisLabel.interval;
      }
      if (chartxAxisLabel.rotate) {
        xAxis.labelRotate = chartxAxisLabel.rotate;
      }
      if (chartxAxisLabel.width || chartxAxisLabel.overflow) {
        xAxis.ellipsis = {};
        if (chartxAxisLabel.width) {
          xAxis.ellipsis.labelWidth = chartxAxisLabel.width;
        }
        if (chartxAxisLabel.overflow) {
          xAxis.ellipsis.overflow = chartxAxisLabel.overflow;
        }
      }

      if (chartxAxis.nameLocation) {
        xAxis.nameLocation = chartxAxis.nameLocation;
      }
    }
    if(chartxAxis.nameTruncate) {
        xAxis.nameTruncate = chartxAxis.nameTruncate;
    }
    
    xAxis.data = 'Name';
    return xAxis;
  } else {
    return false;
  }
}

export default handlexAxis;
