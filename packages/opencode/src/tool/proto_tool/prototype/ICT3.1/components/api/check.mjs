import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UIValidatorService } from './schema_reviewer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'data2.json');

let data;
try {
  data = JSON.parse(readFileSync(dataFile, 'utf8'));
} catch (e) {
  console.error(`读取/解析数据失败 [${dataFile}]: ${e.message}`);
  process.exit(2);
}

const service = new UIValidatorService();
const errors = service.validate(data);

console.log(`数据文件: ${dataFile}`);
console.log(`Schema 目录: ${service.apiDir}`);
console.log(`已加载 Schema: ${Object.keys(service.validators).length} 个`);
console.log(`共发现 ${errors.length} 个问题：`);
errors.forEach((e) => console.log(`- ${e}`));

process.exitCode = errors.length ? 1 : 0;
