/**
 * PageReader — 读取 A2UI 页面源文件
 *
 * 支持两种输入模式：
 * 1. 文件系统（CLI）：读取 pagesDir 下每个页面目录中的单 JSON 文件（xxx.json）
 *    格式为 { planner: { rootId, elements, slots }, mergedA2UI: { rootId, elements, state } }
 * 2. 内存（API）：传入 HuiCodeInput[] 数组
 *    格式同 [{ planner: { rootId, elements, slots }, mergedA2UI: { rootId, elements, state } }]
 *
 * 两种模式统一输出为内部标准格式：
 *   {
 *     pageName: string,            // 文件夹名或自动生成名（路由名）
 *     a2uiDoc: {
 *       state: object,
 *       rootId: string,
 *       elements: Array<object>,
 *     },
 *     splitMeta: Array<{ id_prefix, section_id, element_id }>,
 *   }
 */
import fs from 'fs';
import path from 'path';

interface PageInput {
  planner?: { rootId: string; elements: any[]; slots: Array<{ id_prefix: string; section_id: string; element_id: string }> };
  mergedA2UI?: { rootId: string; elements: any[]; state: Record<string, any>; pageName?: string };
  _pageName?: string;
}

interface PageData {
  planner: any;
  mergedA2UI: any;
  _pageName: string;
}

interface PageOutput {
  pageName: string;
  a2uiDoc: {
    state: Record<string, any>;
    rootId: string;
    elements: any[];
  };
  splitMeta: Array<{ id_prefix: string; section_id: string; element_id: string }>;
}

export class PageReader {
  /**
   * 读取单个页面文件夹（单文件格式：xxx.json 含 planner + mergedA2UI）
   * @param pagePath - 页面文件夹绝对路径
   * @returns {{ planner, mergedA2UI, _pageName }}
   */
  static readPage(pagePath: string): PageData {
    const pageName = path.basename(pagePath);
    const files = fs.readdirSync(pagePath).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error(`[PageReader] 页面目录中没有 JSON 文件: ${pagePath}`);
    }

    // 取第一个 .json 文件（单文件模式）
    const raw = JSON.parse(fs.readFileSync(path.join(pagePath, files[0]), 'utf-8'));
    if (!raw.planner) throw new Error(`[PageReader] ${pagePath} 缺少 planner 字段`);
    if (!raw.mergedA2UI) throw new Error(`[PageReader] ${pagePath} 缺少 mergedA2UI 字段`);

    return {
      planner: raw.planner,
      mergedA2UI: raw.mergedA2UI,
      _pageName: pageName, // 携带文件夹名用于 pageName
    };
  }

  /**
   * 扫描 pagesDir 读取所有有效页面
   * @param pagesDir - 页面源目录
   * @returns Array<{ planner, mergedA2UI, _pageName }>
   */
  static readAll(pagesDir: string): PageData[] {
    const absDir = path.resolve(pagesDir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`[PageReader] 页面目录不存在: ${absDir}`);
    }

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    const pageDirs = entries
      .filter(e => e.isDirectory())
      .map(e => path.join(absDir, e.name));

    return pageDirs.map(dir => {
      try {
        return PageReader.readPage(dir);
      } catch (err: any) {
        console.warn(`  ⚠  跳过页面 ${path.basename(dir)}: ${err.message}`);
        return null;
      }
    }).filter(Boolean) as PageData[];
  }

  /**
   * 从内存数据解析页面（HuiCodeInput 格式）
   *
   * 统一消费 { planner, mergedA2UI } 格式：
   *   - planner = { rootId, elements, slots }
   *   - mergedA2UI = { rootId, elements, state }
   *
   * @param pages - HuiCodeInput 数组
   * @returns Array<{ pageName, a2uiDoc: { state, rootId, elements }, splitMeta }>
   */
  static readFromData(pages: PageInput[]): PageOutput[] {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('[PageReader] pages 必须为非空数组');
    }

    return pages.map((item, index) => {
      const planner: { slots?: Array<{ id_prefix: string; section_id: string; element_id: string }> } = item.planner || {};
      const a2uiDoc: { rootId?: string; elements?: any[]; state?: Record<string, any>; pageName?: string } = item.mergedA2UI || {};

      if (!Array.isArray(planner.slots)) {
        throw new Error(`[PageReader] pages[${index}] planner 缺少 slots`);
      }
      if (!a2uiDoc.rootId) {
        throw new Error(`[PageReader] pages[${index}] mergedA2UI 缺少 rootId`);
      }
      if (!Array.isArray(a2uiDoc.elements)) {
        throw new Error(`[PageReader] pages[${index}] mergedA2UI 缺少 elements`);
      }

      // 优先使用 readPage 携带的 _pageName（文件夹名），其次 a2uiDoc.pageName，最后自动生成
      const pageName = item._pageName || a2uiDoc.pageName || `page_${a2uiDoc.rootId}`;

      return {
        pageName,
        a2uiDoc: {
          state: a2uiDoc.state || {},
          rootId: a2uiDoc.rootId,
          elements: a2uiDoc.elements,
        },
        splitMeta: planner.slots,
      };
    });
  }
}