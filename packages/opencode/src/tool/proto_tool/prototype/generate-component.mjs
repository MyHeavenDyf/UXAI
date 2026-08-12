#!/usr/bin/env node
// generate-component-api.mjs
// Generates all component/*.md files from ICT3.1 source files.
// Usage: node references/generate-component-api.mjs  (run from references/ dir)
// Works on Windows, macOS, and Linux.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';

const SRC_API = './ICT3.1/components/api';
const SRC_DESIGN = './ICT3.1/design/components';
const SRC_EXAMPLE = './ICT3.1/components/example';
const OUT_DIR = './component';

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const SKIP_FILES = new Set(['children.json', 'data.json', 'data2.json']);

// =============================================================
// Helpers
// =============================================================

function findApiJson(componentName) {
  for (const dir of readdirSync(SRC_API)) {
    const dirPath = join(SRC_API, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const filePath = join(dirPath, `${componentName}.json`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function findExampleMd(componentName) {
  for (const dir of readdirSync(SRC_EXAMPLE)) {
    const dirPath = join(SRC_EXAMPLE, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const filePath = join(dirPath, `${componentName}.md`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function findDesignMd(componentName) {
  // Try lowercase: InputNumber -> inputnumber.md
  const lowerPath = join(SRC_DESIGN, `${componentName.toLowerCase()}.md`);
  if (existsSync(lowerPath)) return lowerPath;
  // Try exact: Badge -> badge.md
  const exactPath = join(SRC_DESIGN, `${componentName}.md`);
  if (existsSync(exactPath)) return exactPath;
  return null;
}

function refName(ref) {
  return ref.split('/').pop();
}

// =============================================================
// Schema → Type String
// =============================================================

function schemaType(schema) {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.oneOf) return schema.oneOf.map(schemaType).join(' | ');
  if (schema.enum) return schema.enum.map(v => `"${v}"`).join(' | ');
  // Multi-type array: ["string", "number"] → "string | number"
  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ');
  }
  if (schema.type === 'array') {
    if (!schema.items) return 'any[]';
    // Array of objects with properties → inline object
    if (schema.items.properties) {
      return inlineObject(schema.items) + '[]';
    }
    return schemaType(schema.items) + '[]';
  }
  if (schema.type === 'object' && schema.properties) {
    return inlineObject(schema);
  }
  return schema.type || 'any';
}

function inlineObject(schema) {
  const props = schema.properties || {};
  const required = schema.required || [];
  const parts = Object.entries(props).map(([k, v]) => {
    const opt = required.includes(k) ? '' : '?';
    return `\`${k}${opt}\`: ${schemaType(v)}`;
  });
  return '{ ' + parts.join(', ') + ' }';
}

// =============================================================
// Schema → Props Markdown
// =============================================================

function propsToMarkdown(propsSchema, indent = '') {
  const lines = [];
  const required = propsSchema.required || [];
  const properties = propsSchema.properties || {};

  for (const [key, schema] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    const optMark = isRequired ? '' : '?';

    // Default value
    let defaultStr = '';
    if (schema.default !== undefined) {
      const dv = typeof schema.default === 'string' ? `"${schema.default}"` : schema.default;
      defaultStr = ` (default: ${dv})`;
    }

    // Description
    let descStr = '';
    if (schema.description) descStr = ` — ${schema.description}`;

    // Case 1: Object with properties → expand as sub-bullets
    if (schema.type === 'object' && schema.properties) {
      const descOnly = descStr ? `:${descStr}` : ':';
      lines.push(`${indent}- \`${key}${optMark}\`${descOnly}`);
      lines.push(propsToMarkdown(schema, indent + '  '));
      continue;
    }

    // Case 2: oneOf where one option is array-of-objects → inline
    if (schema.oneOf) {
      const typeStr = schemaType(schema);
      lines.push(`${indent}- \`${key}${optMark}\`: ${typeStr}${defaultStr}${descStr}`);
      continue;
    }

    // Case 3: Simple type / enum / $ref / array
    const typeStr = schemaType(schema);
    lines.push(`${indent}- \`${key}${optMark}\`: ${typeStr}${defaultStr}${descStr}`);
  }

  return lines.join('\n');
}

// =============================================================
// Children Section
// =============================================================

function childrenToMarkdown(childrenSchema) {
  if (!childrenSchema) return null;

  let typeStr;
  if (childrenSchema.$ref) {
    typeStr = refName(childrenSchema.$ref);
  } else if (childrenSchema.oneOf) {
    typeStr = childrenSchema.oneOf.map(s => {
      if (s.$ref) return refName(s.$ref);
      if (s.type === 'array') {
        const itemType = s.items ? schemaType(s.items) : 'any';
        return `${itemType}[]`;
      }
      return schemaType(s);
    }).join(' | ');
  } else if (childrenSchema.type === 'array') {
    const itemType = childrenSchema.items ? schemaType(childrenSchema.items) : 'any';
    typeStr = `${itemType}[]`;
  } else {
    typeStr = schemaType(childrenSchema);
  }

  const desc = childrenSchema.description ? `\n> ${childrenSchema.description}` : '';
  return `## children\n类型: ${typeStr}${desc}`;
}

// =============================================================
// Main: Generate one component file
// =============================================================

function generateComponent(apiPath) {
  const fileName = basename(apiPath, '.json');
  const raw = readFileSync(apiPath, 'utf-8');
  const schema = JSON.parse(raw);

  // Component name: prefer "name", then "title", then filename
  const componentName = schema.name || schema.title || fileName;
  const description = schema.description || '';
  const propsSchema = schema.properties?.props || {};
  const childrenSchema = schema.properties?.children;
  const hasChildren = !!childrenSchema;

  const requiredProps = propsSchema.required || [];
  const propsHeader = requiredProps.length > 0
    ? `## props (required: ${requiredProps.map(r => `\`${r}\``).join(', ')})`
    : '## props';

  // Build header
  const descLine = description ? `> ${description}\n` : '';
  const childMarker = hasChildren ? ' | children: object' : '';
  const header = `# ${componentName}\n${descLine}> id: string | component: "${componentName}" | props: object${childMarker}`;

  // Build props section
  const propsMd = propsToMarkdown(propsSchema);

  // Build children section
  const childrenMd = childrenToMarkdown(childrenSchema);

  // Find design spec
  const designPath = findDesignMd(fileName);
  let designMd = null;
  if (designPath) {
    const designContent = readFileSync(designPath, 'utf-8').trimEnd();
    designMd = designContent;
  }

  // Find example
  const examplePath = findExampleMd(fileName);
  let exampleMd = null;
  if (examplePath) {
    exampleMd = readFileSync(examplePath, 'utf-8').trimEnd();
  }

  // Assemble
  const sections = [header, `${propsHeader}\n${propsMd}`];
  if (childrenMd) sections.push(childrenMd);

  if (designMd) {
    sections.push('------');
    sections.push(designMd);
  }

  if (exampleMd) {
    sections.push('------');
    sections.push(exampleMd);
  }

  const output = sections.join('\n\n') + '\n';

  // Write
  const outPath = join(OUT_DIR, `${fileName}.md`);
  writeFileSync(outPath, output);
  console.log(`Generated: ${fileName}.md`);
  return fileName;
}

// =============================================================
// Shared Definitions → _shared.md
// =============================================================

function defToMarkdown(name, schema) {
  const lines = [];
  const desc = schema.description ? `\n> ${schema.description}` : '';

  // Array type (like StaticChildren)
  if (schema.type === 'array') {
    lines.push(`## ${name}${desc}`);
    lines.push(`类型: array`);
    if (schema.items) {
      lines.push(propsToMarkdown({ properties: { items: schema.items }, required: ['items'] }));
    }
    return lines.join('\n');
  }

  // Object type with properties (like DataBinding, Action, TemplateChildren, SlotNode)
  if (schema.type === 'object' && schema.properties) {
    lines.push(`## ${name}${desc}`);
    const required = schema.required || [];
    for (const [k, v] of Object.entries(schema.properties)) {
      const opt = required.includes(k) ? '' : '?';
      const vDesc = v.description ? ` — ${v.description}` : '';
      // Nested object with properties → expand as sub-bullets
      if (v.type === 'object' && v.properties) {
        lines.push(`- \`${k}${opt}\`:${vDesc}`);
        lines.push(propsToMarkdown(v, '  '));
      } else {
        const typeStr = schemaType(v);
        lines.push(`- \`${k}${opt}\`: ${typeStr}${vDesc}`);
      }
    }
    return lines.join('\n');
  }

  // Fallback
  lines.push(`## ${name}${desc}`);
  lines.push(`类型: ${schemaType(schema)}`);
  return lines.join('\n');
}

function generateShared() {
  const defs = {};
  // Collect all unique $defs from all component schemas
  for (const dir of readdirSync(SRC_API)) {
    const dirPath = join(SRC_API, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith('.json') || SKIP_FILES.has(file)) continue;
      try {
        const schema = JSON.parse(readFileSync(join(dirPath, file), 'utf-8'));
        if (schema.$defs) {
          for (const [k, v] of Object.entries(schema.$defs)) {
            if (!defs[k]) defs[k] = v;
          }
        }
      } catch(e) {}
    }
  }

  const sections = ['# Shared Definitions\n\n以下类型被多个组件复用，属性引用这些名称时参照此定义：'];
  for (const [name, schema] of Object.entries(defs)) {
    sections.push(defToMarkdown(name, schema));
  }

  const output = sections.join('\n\n') + '\n';
  writeFileSync(join(OUT_DIR, '_shared.md'), output);
  console.log('Generated: _shared.md');
}

// =============================================================
// Index → index.md
// =============================================================

function generateIndex(components) {
  // Category display name mapping
  const categoryNames = {
    General: 'General',
    Navigation: 'Navigation',
    DataEntry: 'DataEntry',
    DataDisplay: 'DataDisplay',
    Feedback: 'Feedback',
    Chart: 'Chart',
    Custom: 'Custom',
    HTML: 'HTML',
  };

  const lines = [
    '# Component API Index',
    '',
    '生成 A2UI JSON 前，先确定要用哪些组件，然后只读取对应的文件。',
    '',
    '- 共 ' + components.length + ' 个组件，按需读取。',
    '- 每个文件包含该组件的完整 API（props / types / enums）、设计规范、使用示例。',
    '- 共享类型定义见 `_shared.md`。',
    '',
    '| 组件 | 文件 | 分类 |',
    '|---|---|---|',
  ];

  for (const { name, category } of components) {
    const cat = categoryNames[category] || category;
    lines.push('| `' + name + '` | [' + name + '.md](' + name + '.md) | ' + cat + ' |');
  }

  const output = lines.join('\n') + '\n';
  writeFileSync(join(OUT_DIR, 'index.md'), output);
  console.log('Generated: index.md');
}

// =============================================================
// Run
// =============================================================

console.log('Generating component files...\n');

// Collect all component JSON files (with category)
const components = [];
for (const dir of readdirSync(SRC_API)) {
  const dirPath = join(SRC_API, dir);
  if (!statSync(dirPath).isDirectory()) continue;
  for (const file of readdirSync(dirPath)) {
    if (!file.endsWith('.json')) continue;
    const name = basename(file, '.json');
    if (SKIP_FILES.has(file)) continue;
    components.push({ name, category: dir, path: join(dirPath, file) });
  }
}

// Sort alphabetically
components.sort((a, b) => a.name.localeCompare(b.name));

// Generate each component
let count = 0;
for (const { path: apiPath } of components) {
  try {
    generateComponent(apiPath);
    count++;
  } catch (e) {
    console.error(`ERROR generating ${basename(apiPath)}: ${e.message}`);
  }
}

// Generate _shared.md
generateShared();

// Generate index.md
generateIndex(components);

console.log(`\nDone: ${count} components + _shared.md + index.md generated.`);
