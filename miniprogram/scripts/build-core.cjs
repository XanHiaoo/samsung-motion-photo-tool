const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../web/node_modules/typescript');

const sourceRoot = path.resolve(__dirname, '../../web/src/core');
const outputRoot = path.resolve(__dirname, '../src/core');
const check = process.argv.includes('--check');
const visited = new Set();

function compile(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const source = fs.readFileSync(path.join(sourceRoot, `${name}.ts`), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: `${name}.ts`,
  });
  const output = `// Generated from web/src/core/${name}.ts. Run node miniprogram/scripts/build-core.cjs.\n${result.outputText.replace(/\r\n/g, '\n')}`;
  const file = path.join(outputRoot, `${name}.js`);
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== output) {
      throw new Error(`Shared core is stale: ${file}`);
    }
  } else {
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(file, output);
  }
  for (const match of output.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) compile(match[1]);
}

// Only byte-based dependencies; browser File pairing stays in the Web client.
compile('mux');
compile('analyze');
compile('embedded');
console.log(`Shared core ${check ? 'checked' : 'built'} (${visited.size} modules).`);
