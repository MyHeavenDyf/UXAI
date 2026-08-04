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

const H5_TAG_RE = /^[a-z]+[1-6]?$/;
const H5_KEY = 'H5';

class UIValidatorService {
  constructor(apiDir) {
    this.validators = {};
    this.apiDir = apiDir
      ? path.resolve(apiDir)
      : path.resolve(__dirname);
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

    const schemaKey = H5_TAG_RE.test(compType) ? H5_KEY : compType;
    const validator = this.validators[schemaKey];
    if (validator) {
      const ok = validator(node);
      if (!ok && validator.errors) {
        for (const err of validator.errors) {
          const p = err.instancePath
            ? String(err.instancePath).replace(/^\//, '').replace(/\//g, '.')
            : 'root';
          ctx.errors.push(`❌ ${display} [Schema]: ${p || 'root'} ${err.message}`);
        }
      }
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

  validate(data) {
    if(data.mergedA2UI)
      data=data.mergedA2UI;
    const ctx = {
      errors: [],
      visitedIds: new Set(),
      usedStatePaths: new Set(),
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
