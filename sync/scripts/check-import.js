import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const files = ['src/build-catalog.js','scripts/validate.js', ...fs.readdirSync('src/import').filter(f => f.endsWith('.js')).map(f => path.join('src/import',f))];
for (const file of files) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log(`Syntax checks passed: ${files.length} JavaScript files. No TypeScript or linter is configured in this repository.`);
