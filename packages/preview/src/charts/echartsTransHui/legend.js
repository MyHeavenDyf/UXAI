// 图例转换
function handleLegend(chartOption, type) {
  const legend = {};
  if (!chartOption.legend) {
    legend.show = false;
  } else {
    // 图例位于底部的类型
    const bottomType = ['BarChart', 'LineChart'];
    // 图例位于右部的类型
    const rightType = ['PieChart'];
    legend.show = true;
    if (bottomType.indexOf(type) !== -1) {
      legend.position = {
        left: 'center',
        bottom: 14,
      };
      legend.orient = 'horizontal';
    }
    if (rightType.indexOf(type) !== -1) {
      legend.position = {
        right: '8%',
        top: 'center',
      };
      legend.orient = 'vertical';
    }
  }
  return legend;
}

export default handleLegend;
