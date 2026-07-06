/**
 * mappings/index.ts — 组件库映射统一注册表
 *
 * 通过静态 ESM 导入集中注册所有目标组件库的映射。
 * 管线通过 ctx.targetLib 选择对应库的映射对象。
 */
import * as eviewReact from './eview-react/index';

export const mappingRegistry: Record<string, any> = {
  'eview-react': eviewReact.default,
  // ── 后续添加其他库 ──
  // 'antd': antd,
  // 'material-ui': materialUi,
};