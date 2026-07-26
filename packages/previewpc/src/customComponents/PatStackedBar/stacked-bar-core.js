/**
 * stacked-bar-core.js
 * 纯原生 JS 实现的横向堆叠条形图渲染引擎
 */
export class StackedBarChart {
  /**
   * @param {HTMLElement|string} container - 挂载的 DOM 容器或选择器
   */
  constructor(container) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    
    // 内部写死的统一样式规范 (外部不可修改，保证设计一致性)
    this.options = {
      height: '14px',       // 柱子宽度(高度)
      borderRadius: '7px',  // 完美半圆圆角 (高度的一半)
      gap: '2px',           // 区块间隔
      animate: true         // 开启宽度平滑动画
    };
    
    this.init();
  }

  // 初始化 DOM 骨架
  init() {
    this.container.classList.add('sbc-container');
    
    // 进度条轨道
    this.barWrapper = document.createElement('div');
    this.barWrapper.className = 'sbc-bar-wrapper';
    this.barWrapper.style.height = this.options.height;
    this.barWrapper.style.borderRadius = this.options.borderRadius;
    this.barWrapper.style.gap = this.options.gap;

    // 图例容器
    this.legendWrapper = document.createElement('div');
    this.legendWrapper.className = 'sbc-legend-wrapper';

    this.container.appendChild(this.barWrapper);
    this.container.appendChild(this.legendWrapper);
  }

  /**
   * 渲染数据到 DOM
   * @param {Array} data - [{ label: '正常', value: 150, color: '#10b981' }, ...]
   */
  render(data) {
    if (!data || !Array.isArray(data)) return;

    // 计算总值，用于分配百分比宽度
    const total = data.reduce((sum, item) => sum + (item.value || 0), 0);

    // 清空重绘
    this.barWrapper.innerHTML = '';
    this.legendWrapper.innerHTML = '';

    data.forEach(item => {
      // 忽略小于等于 0 的数据段
      if (item.value <= 0) return;
      
      const percentage = total === 0 ? 0 : (item.value / total) * 100;

      // 1. 渲染柱状区块
      const segment = document.createElement('div');
      segment.className = 'sbc-bar-segment';
      segment.style.backgroundColor = item.color || '#ccc';
      segment.title = `${item.label}: ${item.value} (${percentage.toFixed(1)}%)`;

      // 处理动画
      if (this.options.animate) {
        segment.style.width = '0%';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            segment.style.width = `${percentage}%`;
          });
        });
      } else {
        segment.style.width = `${percentage}%`;
      }

      this.barWrapper.appendChild(segment);

      // 2. 渲染图例
      const legendItem = document.createElement('div');
      legendItem.className = 'sbc-legend-item';

      // 上半部分：数字
      const valueBox = document.createElement('div');
      valueBox.className = 'sbc-legend-value';
      valueBox.innerText = item.value;

      // 下半部分：圆点 + 文字
      const labelBox = document.createElement('div');
      labelBox.className = 'sbc-legend-label';

      const dot = document.createElement('span');
      dot.className = 'sbc-legend-dot';
      dot.style.backgroundColor = item.color || '#ccc';

      const text = document.createElement('span');
      text.className = 'sbc-legend-text';
      text.innerText = item.label;

      labelBox.appendChild(dot);
      labelBox.appendChild(text);

      legendItem.appendChild(valueBox);
      legendItem.appendChild(labelBox);
      this.legendWrapper.appendChild(legendItem);
    });
  }

  // 销毁实例，清理 DOM
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('sbc-container');
    }
  }
}