import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

function _loadAjv() {
  try { return _require('ajv'); } catch {}
  let dir = __dirname;
  while (dir && dir !== path.dirname(dir)) {
    for (const p of [
      path.join(dir, 'app', 'node_modules', 'ajv'),
      path.join(dir, 'node_modules', 'ajv'),
      path.join(dir, 'packages', 'app', 'node_modules', 'ajv'),
    ]) {
      if (fs.existsSync(p)) {
        const mod = _require(p);
        return mod.default || mod;
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error("无法解析 ajv，请在 packages/app 或 packages/opencode 安装 ajv");
}

const Ajv = _loadAjv();

const H5_KEY = 'H5';
const HTML_TAGS = new Set([
  'html', 'head', 'body', 'base', 'link', 'meta', 'style', 'title',
  'header', 'footer', 'main', 'nav', 'section', 'aside', 'article', 'address', 'hgroup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark',
  'code', 'pre', 'samp', 'kbd', 'var', 'cite', 'q', 'abbr', 'dfn', 'time',
  'bdi', 'bdo', 'wbr', 'br', 'hr', 'blockquote', 'figure', 'figcaption', 'ins', 'del',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'label',
  'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter',
  'img', 'picture', 'source', 'video', 'audio', 'iframe', 'canvas',
  'embed', 'object', 'param', 'track', 'map', 'area',
  'details', 'summary', 'dialog', 'script', 'noscript', 'template', 'slot'
]);

class UIValidatorService {
  constructor(apiDir) {
    this.validators = {};
    this.schemas = {};
    this._propValCache = new WeakMap();
    if (apiDir) {
      this.apiDir = path.resolve(apiDir);
    } else {
      const sub = path.resolve(__dirname, 'api');
      this.apiDir = fs.existsSync(sub) ? sub : path.resolve(__dirname);
    }
    this._ajv = new Ajv({ allErrors: true, strict: false });
    this._loadSchemas();
  }

  _loadSchemas() {
    if (!fs.existsSync(this.apiDir)) {
      console.warn(`----- 警告: 找不到 Schema 目录 ${this.apiDir} -----`);
      return;
    }
    const files = this._collectJsonFiles(this.apiDir);
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!this._looksLikeSchema(content)) continue;
        const name = path.basename(file, '.json');
        this.schemas[name] = content;
        this.validators[name] = this._ajv.compile(content);
      } catch (e) {
        console.error(`----- 加载 Schema 失败 [${file}]: ${e && e.message ? e.message : e} -----`);
      }
    }
  }

  _looksLikeSchema(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    if ('properties' in obj || '$defs' in obj || 'definitions' in obj || '$schema' in obj || '$id' in obj || '$ref' in obj || 'additionalProperties' in obj || 'items' in obj || 'required' in obj) return true;
    const t = obj.type;
    if (Array.isArray(t)) return true;
    if (typeof t === 'string' && ['object', 'string', 'array', 'number', 'integer', 'boolean', 'null'].includes(t)) return true;
    return false;
  }

  _collectJsonFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        out.push(...this._collectJsonFiles(path.join(dir, entry.name)));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(path.join(dir, entry.name));
      }
    }
    return out;
  }

  _extractStatePaths(obj, prefix = '', paths = new Set()) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (prefix) paths.add(prefix);
      for (const [k, v] of Object.entries(obj)) {
        this._extractStatePaths(v, `${prefix}/${k}`, paths);
      }
    } else if (Array.isArray(obj)) {
      paths.add(prefix);
      for (let i = 0; i < obj.length; i++) {
        this._extractStatePaths(obj[i], `${prefix}/${i}`, paths);
        this._extractStatePaths(obj[i], `${prefix}/*`, paths);
      }
    } else {
      paths.add(prefix);
    }
    return paths;
  }

  _validateNode(nodeId, nodeMap, ctx, currentScope = '') {
    const node = nodeMap.get(nodeId);
    if (!node) {
      ctx.errors.push(`❌ <${nodeId}>: 找不到该节点定义`);
      return;
    }

    const compType = node.component || 'Unknown';
    const cid = node.id || 'unknown';
    ctx.visitedIds.add(nodeId);
    const display = `<${compType} id='${cid}'>`;

    const schemaKey = this.validators[compType]
      ? compType
      : (HTML_TAGS.has(compType.toLowerCase()) ? H5_KEY : compType);
    const validator = this.validators[schemaKey];
    if (validator) {
      const nodeForSchema = (schemaKey === H5_KEY && compType !== compType.toLowerCase())
        ? { ...node, component: compType.toLowerCase() }
        : node;
      const ok = validator(nodeForSchema);
      if (!ok && validator.errors) {
        for (const err of validator.errors) {
          if (this._isDataBinding(this._getValueAtPath(node, err.instancePath))) continue;
          const p = err.instancePath
            ? String(err.instancePath).replace(/^\//, '').replace(/\//g, '.')
            : 'root';
          ctx.errors.push(`❌ ${display} [Schema]: ${p || 'root'} ${err.message}`);
        }
      }
      this._checkBindingValues(node, schemaKey, currentScope, ctx, display);
    } else {
      ctx.errors.push(`⚠️ ${display} [Schema]: 未找到 ${schemaKey}.json 校验定义`);
    }

    const props = node.props;
    if (props && typeof props === 'object') {
      this._validateStatePathsInProps(props, currentScope, ctx, display);
    }
    const children = node.children;
    if (children && typeof children === 'object') {
      this._validateStatePathsInProps(children, currentScope, ctx, display);
    }

    this._scanNested(node.children, nodeMap, ctx, currentScope);
    this._scanNested(node.props, nodeMap, ctx, currentScope);
  }

  _scanNested(obj, nodeMap, ctx, currentScope = '') {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'string') {
          if (nodeMap.has(item)) {
            this._validateNode(item, nodeMap, ctx, currentScope);
          }
        } else if (item && typeof item === 'object') {
          this._scanNested(item, nodeMap, ctx, currentScope);
        }
      }
    } else if (obj && typeof obj === 'object') {
      if ('componentId' in obj) {
        const cid = obj.componentId;
        let nextScope = currentScope;
        if ('path' in obj && typeof obj.path === 'string') {
          nextScope = this._resolveStatePath(obj.path, currentScope);
        }
        if (nodeMap.has(cid)) {
          this._validateNode(cid, nodeMap, ctx, nextScope);
        } else {
          ctx.errors.push(`❌ 找不到插槽组件 ID: <${cid}>`);
        }
        for (const [k, v] of Object.entries(obj)) {
          if (k !== 'componentId' && v && typeof v === 'object') {
            this._scanNested(v, nodeMap, ctx, currentScope);
          }
        }
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === 'object') {
            this._scanNested(v, nodeMap, ctx, currentScope);
          }
        }
      }
    }
  }

  _resolveStatePath(raw, currentScope) {
    let p = raw;
    if (p.startsWith('./')) p = p.slice(2);
    if (p === '.' || p === '') return currentScope;
    if (p.startsWith('/')) return p;
    return currentScope === '' ? `/${p}` : `${currentScope}/*/${p}`;
  }

  _isDataBinding(v) {
    return v && typeof v === 'object' && !Array.isArray(v) && typeof v.path === 'string';
  }

  _getValueAtPath(root, instancePath) {
    if (!instancePath) return root;
    let cur = root;
    for (const p of String(instancePath).split('/').filter(Boolean)) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return undefined;
    }
    return cur;
  }

  _getPropValidator(schemaProp, parentDefs) {
    if (this._propValCache.has(schemaProp)) return this._propValCache.get(schemaProp);
    const wrapped = { ...schemaProp };
    if (parentDefs && Object.keys(parentDefs).length) wrapped.$defs = parentDefs;
    let v;
    try { v = this._ajv.compile(wrapped); }
    catch (e) { v = null; }
    this._propValCache.set(schemaProp, v);
    return v;
  }

  _resolveStateValues(fullPath, state) {
    const parts = String(fullPath).split('/').filter(Boolean);
    let cur = [state];
    for (const p of parts) {
      const next = [];
      if (p === '*') {
        for (const c of cur) if (Array.isArray(c)) for (const it of c) next.push(it);
      } else {
        for (const c of cur) {
          if (c && typeof c === 'object' && p in c) next.push(c[p]);
        }
      }
      cur = next;
    }
    return cur;
  }

  _checkBindingValues(node, schemaKey, currentScope, ctx, display) {
    const schema = this.schemas[schemaKey];
    if (!schema) return;
    const propsSchema = schema.properties && schema.properties.props;
    if (!propsSchema || !propsSchema.properties) return;
    const parentDefs = schema.$defs || {};
    const walk = (dataVal, schemaProp, scope, label) => {
      if (!schemaProp) return;
      if (this._isDataBinding(dataVal)) {
        const full = this._resolveStatePath(dataVal.path, scope);
        const values = this._resolveStateValues(full, ctx.state);
        if (values.length === 0) return;
        const valValidator = this._getPropValidator(schemaProp, parentDefs);
        if (!valValidator) return;
        for (const v of values) {
          if (v !== null && typeof v === 'object') continue;
          const ok = valValidator(v);
          if (!ok && valValidator.errors) {
            const detail = valValidator.errors.map((e) => e.message).join('; ');
            ctx.errors.push(`❌ ${display} [DataBinding]: props.${label} 解析值 ${JSON.stringify(v)} 不符合 schema: ${detail} (path '${dataVal.path}' -> '${full}')`);
          }
        }
        return;
      }
      if (dataVal && typeof dataVal === 'object' && !Array.isArray(dataVal) && schemaProp.properties) {
        for (const [k, v] of Object.entries(dataVal)) {
          if (schemaProp.properties[k]) walk(v, schemaProp.properties[k], scope, label ? `${label}.${k}` : k);
        }
      }
    };
    if (node.props && typeof node.props === 'object') {
      for (const [k, v] of Object.entries(node.props)) {
        if (propsSchema.properties[k]) walk(v, propsSchema.properties[k], currentScope, k);
      }
    }
  }

  _validateStatePathsInProps(obj, currentScope, ctx, displayPath) {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object') {
          this._validateStatePathsInProps(item, currentScope, ctx, displayPath);
        }
      }
      return;
    }
    if (!obj || typeof obj !== 'object') return;

    if ('path' in obj && typeof obj.path === 'string') {
      const raw = obj.path;
      const fullPath = this._resolveStatePath(raw, currentScope);

      if (!ctx.validStatePaths.has(fullPath)) {
        ctx.errors.push(`❌ ${displayPath}: 找不到状态映射 '${fullPath}' (原始定义: '${raw}')`);
      } else {
        ctx.usedStatePaths.add(fullPath);
        const parts = fullPath.split('/');
        let agg = '';
        for (let i = 1; i < parts.length; i++) {
          agg += '/' + parts[i];
          ctx.usedStatePaths.add(agg);
        }
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'path' && v && typeof v === 'object') {
        this._validateStatePathsInProps(v, currentScope, ctx, displayPath);
      }
    }
  }

  _checkSharedNodes(nodeMap, ctx) {
    const refs = new Map();
    const record = (cid, from) => {
      if (!refs.has(cid)) refs.set(cid, []);
      refs.get(cid).push(from);
    };
    const walk = (obj, from) => {
      if (Array.isArray(obj)) {
        for (const it of obj) {
          if (typeof it === 'string') { if (nodeMap.has(it)) record(it, from); }
          else if (it && typeof it === 'object') walk(it, from);
        }
      } else if (obj && typeof obj === 'object') {
        if ('componentId' in obj && typeof obj.componentId === 'string' && nodeMap.has(obj.componentId)) {
          record(obj.componentId, from);
        }
        for (const [k, v] of Object.entries(obj)) {
          if (k !== 'componentId' && v && typeof v === 'object') walk(v, from);
        }
      }
    };
    for (const [id, node] of nodeMap) {
      if (!node) continue;
      walk(node.children, id);
      walk(node.props, id);
    }
    for (const [cid, froms] of refs) {
      if (froms.length > 1) {
        const parents = [...new Set(froms)].map((f) => `<${f}>`).join(', ');
        ctx.errors.push(`❌ 组件 '<${cid}>' 被重复引用 ${froms.length} 次（来自: ${parents}）`);
      }
    }
  }

  validate(data) {
    if(data.mergedA2UI)
      data=data.mergedA2UI;
    const ctx = {
      errors: [],
      visitedIds: new Set(),
      usedStatePaths: new Set(),
      state: (data && data.state) || {},
      validStatePaths: this._extractStatePaths((data && data.state) || {}),
    };

    const elements = (data && Array.isArray(data.elements)) ? data.elements : [];
    const nodeMap = new Map();
    for (const n of elements) {
      if (n && n.id !== undefined) nodeMap.set(n.id, n);
    }

    const rootId = data && data.rootId;
    if (!rootId) return ['❌ 数据缺少 rootId，无法开始校验'];

    this._validateNode(rootId, nodeMap, ctx, '');

    for (const eid of nodeMap.keys()) {
      if (!ctx.visitedIds.has(eid)) {
        ctx.errors.push(`⚠️ 发现游离节点: ${eid}`);
      }
    }

    this._checkSharedNodes(nodeMap, ctx);

    const stateData = data && data.state;
    if (stateData && typeof stateData === 'object' && !Array.isArray(stateData)) {
      for (const key of Object.keys(stateData)) {
        const top = `/${key}`;
        if (!ctx.usedStatePaths.has(top)) {
          ctx.errors.push(`⚠️ 警告: State 中定义了最外层数据源 '${top}'，但在视图层完全未被使用`);
        }
      }
    }

    return ctx.errors;
  }
}

export { UIValidatorService };
