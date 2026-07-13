/**
 * gauge-core.js
 * 纯原生 JS 实现的 SVG 仪表盘渲染引擎
 */
export class GaugeChart {
  /**
   * @param {HTMLElement|string} container - DOM 容器
   * @param {Object} options - 配置项，如 { max: 100 }
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.max = options.max || 100;
    
    // 进度条圆角的起止偏移补正，有效物理弧长
    this.dashArray = 235.3; 
    this.displayValue = 0;
    this.animationFrame = null;
    
    this.init();
  }

  // 初始化 SVG 骨架与静态刻度
  init() {
    this.container.classList.add('gd-container');
    
    // 1. 计算生成 44 个区间（45根）的刻度线字符串
    let ticksSvg = '';
    const outerRadius = 69;
    const innerRadius = 63;
    const tickCount = 44;
    
    for (let i = 0; i <= tickCount; i++) {
      const angle = Math.PI - (i / tickCount) * Math.PI;
      const x1 = 100 + innerRadius * Math.cos(angle);
      const y1 = 100 - innerRadius * Math.sin(angle);
      const x2 = 100 + outerRadius * Math.cos(angle);
      const y2 = 100 - outerRadius * Math.sin(angle);
      ticksSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9ca3af" stroke-width="0.8" stroke-linecap="round" />`;
    }

    // 2. 注入完整的 SVG DOM 结构
    this.container.innerHTML = `
      <svg class="gd-svg" viewBox="0 0 200 110">
        <defs>
          <linearGradient id="gdGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#10b981" />
            <stop offset="100%" stop-color="#0ea5e9" />
          </linearGradient>
          <filter id="gdGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d="M 8 100 A 92 92 0 0 1 192 100" fill="none" stroke="#e5e7eb" stroke-width="1" />
        
        ${ticksSvg}
        
        <path d="M 20.4 92 A 80 80 0 0 1 179.6 92" fill="none" stroke="#f3f4f6" stroke-width="16" stroke-linecap="round" />
        
        <path class="gd-progress" d="M 20.4 92 A 80 80 0 0 1 179.6 92" fill="none" stroke="url(#gdGradient)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${this.dashArray}" stroke-dashoffset="${this.dashArray}" />
        
        <g class="gd-dot-group">
          <circle cx="180" cy="100" r="6" fill="#0ea5e9" filter="url(#gdGlow)" />
        </g>
        
        <text class="gd-value-text" x="100" y="95" text-anchor="middle" font-size="38" font-weight="bold" fill="var(--text-default, #000)">
          <tspan class="gd-number">0</tspan><tspan font-size="16" fill="#6b7280" font-weight="normal" dx="2">%</tspan>
        </text>
      </svg>
    `;

    // 3. 缓存需要动态操作的 DOM 节点
    this.progressEl = this.container.querySelector('.gd-progress');
    this.dotGroupEl = this.container.querySelector('.gd-dot-group');
    this.numberEl = this.container.querySelector('.gd-number');
  }

  /**
   * 渲染/更新数据
   * @param {number} value - 当前值
   */
  render(value) {
    if (!this.progressEl) return;
    
    const clampedValue = Math.min(Math.max(value, 0), this.max);
    const ratio = clampedValue / this.max;

    // 1. 驱动进度条宽度 (stroke-dashoffset)
    const offset = this.dashArray * (1 - ratio);
    this.progressEl.style.strokeDashoffset = offset;

    // 2. 驱动光效点旋转
    // 进度条半径80，线宽16导致圆角向外延伸8px，通过反三角函数求出偏移角进行补正
    const angleOffset = Math.asin(8 / 80) * (180 / Math.PI); 
    const startAngle = -180 + angleOffset;
    const endAngle = -angleOffset;
    const rotation = startAngle + ratio * (endAngle - startAngle);
    
    this.dotGroupEl.style.transform = `rotate(${rotation}deg)`;

    // 3. 触发数字滚动动画
    this.animateNumber(clampedValue);
  }

  // 补间动画引擎：处理数字的滚动
  animateNumber(targetValue) {
    const start = this.displayValue;
    const end = targetValue;
    const duration = 800; // 匹配 CSS 的 0.8s 动画时间
    const startTime = performance.now();

    const animate = (time) => {
      const progress = Math.min((time - startTime) / duration, 1);
      // easeOutExpo 缓动
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      this.displayValue = Math.round(start + (end - start) * ease);
      
      this.numberEl.textContent = this.displayValue;

      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
      }
    };
    
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(animate);
  }

  // 销毁实例，释放内存
  destroy() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('gd-container');
    }
  }
}