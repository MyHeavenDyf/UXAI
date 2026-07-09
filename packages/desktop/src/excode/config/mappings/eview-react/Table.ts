/**
 * Table 组件映射
 *
 * 流程：
 *   - stateData.tableColumns → 纯数据，合并到 initialState
 *   - componentData.tableColumnsJsx → 含 JSX render 函数的 columns，模块顶部 const 声明
 *   - props.columns 引用 { __varRef: 'tableColumnsJsx' }
 */
export default {
  tag: 'Table',
  import: '@nce/eview-react/Table',
  propsMap: {
    dataSource: 'dataset',
  },
  defaults: {
    rowKey: 'key',
  },

  /**
   * transform — 构建 Table 节点
   *
   * 三种 cell 解析模式（按优先级）：
   *   1) col.cell（componentId 引用）→ resolveNode 解析
   *   2) node._loopTemplate.children[idx] → resolveNode 解析
   *   3) 无数据源 → 根据 colKey 模式匹配硬编码 render
   */
  transform(node: any, { rawState, resolveNode }: { rawState: any; resolveNode: any }) {
    const rawColumns = rawState?.tableColumns || [];

    // 获取循环模板中的 cell 节点
    const templateChildren = node._loopTemplate?.children || null;

    // ── 纯数据 columns ──
    const columns = rawColumns.map((col: any) => ({
      key: col.dataIndex || col.key,
      title: col.title,
      width: col.width,
      align: col.align,
      fixed: col.fixed,
    }));

    // ── 含 JSX 的 columns（render 函数）──
    const columnsJsx = rawColumns.map((col: any, idx: number) => {
      const colKey = col.dataIndex || col.key;
      const baseCol: Record<string, any> = {
        key: colKey,
        title: col.title,
        width: col.width,
        align: col.align,
        fixed: col.fixed,
      };

      // 1) col.cell（componentId 引用）→ resolveNode 解析
      if (col.cell && resolveNode) {
        const resolved = resolveNode(col.cell);
        if (resolved) {
          baseCol.render = {
            __type: 'renderFn',
            extract: true,
            refName: `_renderCell_${colKey}`,
            params: '(cellValue, rowData)',
            body: resolved,
          };
          return baseCol;
        }
      }

      // 2) _loopTemplate.children 按索引取 cell 节点 → resolveNode 解析
      if (templateChildren && templateChildren[idx] && resolveNode) {
        const cellNode = templateChildren[idx];
        const resolved = resolveNode(cellNode);
        if (resolved) {
          baseCol.render = {
            __type: 'renderFn',
            extract: true,
            refName: `_renderCell_${colKey}`,
            params: '(cellValue, rowData)',
            body: resolved,
          };
          return baseCol;
        }
      }

      // 3) 无数据源 → 根据 colKey 模式匹配硬编码 render
      if (colKey === 'customerInfo') {
        baseCol.render = {
          __type: 'renderFn',
          extract: true,
          refName: '_renderCell_customerInfo',
          params: '(cellValue, rowData)',
          body: {
            __nodeType: 'html',
            tag: 'div',
            props: { className: 'flex items-center gap-2' },
            children: [
              {
                __nodeType: 'component',
                tag: 'img',
                import: '',
                props: {
                  src: { __binding: true, pathType: 'relative', path: 'customerInfo.avatar' },
                  alt: '',
                  className: 'w-8 h-8 rounded-full',
                },
                selfClosing: true,
              },
              {
                __nodeType: 'html',
                tag: 'div',
                props: { className: 'flex flex-col' },
                children: [
                  {
                    __nodeType: 'html',
                    tag: 'span',
                    props: {
                      className: 'font-medium',
                      value: { __binding: true, pathType: 'relative', path: 'customerInfo.name' },
                    },
                  },
                  {
                    __nodeType: 'html',
                    tag: 'span',
                    props: {
                      className: 'text-xs text-gray-500',
                      value: { __binding: true, pathType: 'relative', path: 'customerInfo.phone' },
                    },
                  },
                ],
              },
            ],
          },
        };
      } else if (colKey === 'statusTag') {
        baseCol.render = {
          __type: 'renderFn',
          extract: true,
          refName: '_renderCell_statusTag',
          params: '(cellValue, rowData)',
          body: {
            __nodeType: 'component',
            tag: 'Tag',
            import: '@nce/eview-react/Tag',
            props: {
              color: { __binding: true, pathType: 'relative', path: 'statusTag.color' },
              value: { __binding: true, pathType: 'relative', path: 'statusTag.text' },
            },
          },
        };
      } else if (colKey === 'action') {
        baseCol.render = {
          __type: 'renderFn',
          extract: true,
          refName: '_renderCell_action',
          params: '(cellValue, rowData)',
          body: {
            __nodeType: 'html',
            tag: 'div',
            props: { className: 'flex gap-2' },
            children: [
              {
                __nodeType: 'component',
                tag: 'Button',
                import: '@nce/eview-react/Button',
                props: {
                  type: 'link',
                  size: 'small',
                  value: '查看详情',
                },
              },
            ],
          },
        };
      } else if (colKey) {
        // 通用列：直接显示数据值
        baseCol.render = {
          __type: 'renderFn',
          extract: true,
          refName: `_renderCell_${colKey}`,
          params: '(cellValue, rowData)',
          body: {
            __nodeType: 'html',
            tag: 'span',
            props: {
              value: { __binding: true, pathType: 'relative', path: colKey },
            },
          },
        };
      }

      return baseCol;
    });

    // props 中的 columns 引用 {{ __varRef: 'tableColumnsJsx' }}
    const props = {
      ...(node.props || {}),
      columns: { __varRef: 'tableColumnsJsx' },
    };

    return {
      props,
      children: null,
      stateData: { tableColumns: columns },
      componentData: { tableColumnsJsx: columnsJsx },
    };
  },
};