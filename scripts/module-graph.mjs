import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MODULE_LAYERS = Object.freeze({
  ui: ['rendering', 'spatial', 'residents'],
  rendering: ['spatial'],
  transport: [],
  creation: ['simulation', 'residents', 'model', 'voxel', 'spatial', 'rendering', 'storage'],
  voxel: ['spatial', 'storage'],
  spatial: [],
  simulation: ['spatial', 'storage'],
  residents: ['simulation'],
  model: [],
  storage: [],
});

const ignoredDirectories = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage']);
const punctuation = (token, ...values) => token?.type === 'punctuation' && values.includes(token.value);

// One deterministic walk for syntax checks, tests, observations, and module guards.
// Hidden directories include .git, .data and .tmp; never follow symlinks.
export function discoverSourceFiles(directory) {
  if (!lstatSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) return [];
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return discoverSourceFiles(file);
    return entry.isFile() && /\.(?:[cm]?js)$/.test(entry.name) ? [file] : [];
  });
}

export const discoverModuleFiles = (root, layers = MODULE_LAYERS) => Object.keys(layers)
  .flatMap(layer => discoverSourceFiles(resolve(root, layer)))
  .filter(file => !basename(file).startsWith('observe-'));

// This is lexical inspection, not a JavaScript parser. Node's syntax check still
// validates grammar. Keep literal contents out of the token stream, but scan the
// expressions inside templates: those can contain real import() calls.
function sourceTokens(source, filename) {
  const tokens = [];
  let offset = source.startsWith('#!') ? source.indexOf('\n') : 0;
  if (offset < 0) return tokens;
  const fail = message => { throw new SyntaxError(`${filename}:${source.slice(0, offset).split('\n').length}: ${message}`); };
  const add = (type, value, start = offset) => tokens.push({ type, value, start });
  const escape = () => {
    const char = source[++offset];
    offset++;
    if (char === '\r') { if (source[offset] === '\n') offset++; return ''; }
    if (['\n', '\u2028', '\u2029'].includes(char)) return '';
    if (char === 'x' || char === 'u') {
      const braced = char === 'u' && source[offset] === '{';
      if (braced) offset++;
      const end = braced ? source.indexOf('}', offset) : offset + (char === 'x' ? 2 : 4);
      const digits = source.slice(offset, end);
      if (end < offset || !/^[\da-f]+$/i.test(digits)) fail('Invalid string escape');
      offset = end + Number(braced);
      return String.fromCodePoint(parseInt(digits, 16));
    }
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[char] ?? char;
  };
  const quoted = quote => {
    const start = offset++;
    let value = '';
    while (offset < source.length && source[offset] !== quote) {
      value += source[offset] === '\\' ? escape() : source[offset++];
    }
    if (offset >= source.length) fail('Unterminated string');
    offset++;
    add('string', value, start);
  };
  const template = () => {
    const start = offset++;
    const token = { type: 'template', value: '', start };
    tokens.push(token);
    let interpolated = false;
    while (offset < source.length) {
      if (source[offset] === '`') { offset++; add('template-end', '`'); return; }
      if (source[offset] === '$' && source[offset + 1] === '{') {
        interpolated = true;
        token.value = null;
        offset += 2;
        add('punctuation', '${');
        code(true);
      } else {
        const char = source[offset] === '\\' ? escape() : source[offset++];
        if (!interpolated) token.value += char;
      }
    }
    fail('Unterminated template');
  };
  const code = (templateExpression = false) => {
    let braces = 0;
    let expressionStart = true;
    const parentheses = [];
    while (offset < source.length) {
      const char = source[offset];
      if (/\s/.test(char)) { offset++; continue; }
      if (source.startsWith('//', offset)) {
        while (offset < source.length && !/[\n\r\u2028\u2029]/.test(source[offset])) offset++;
        continue;
      }
      if (source.startsWith('/*', offset)) {
        const end = source.indexOf('*/', offset + 2);
        if (end < 0) fail('Unterminated comment');
        offset = end + 2;
        continue;
      }
      if (char === '"' || char === "'") { quoted(char); expressionStart = false; continue; }
      if (char === '`') { template(); expressionStart = false; continue; }
      if (char === '/' && expressionStart) {
        const start = offset++;
        let characterClass = false;
        while (offset < source.length) {
          const next = source[offset++];
          if (next === '\\') { offset++; continue; }
          if (next === '[') characterClass = true;
          if (next === ']') characterClass = false;
          if (next === '/' && !characterClass) break;
          if (/[\n\r\u2028\u2029]/.test(next)) fail('Unterminated regular expression');
        }
        while (/[a-z]/i.test(source[offset] ?? '')) offset++;
        add('regexp', '', start);
        expressionStart = false;
        continue;
      }
      if (/[\p{ID_Start}_$]/u.test(String.fromCodePoint(source.codePointAt(offset))) || source.startsWith('\\u', offset)) {
        const start = offset;
        let value = '';
        while (offset < source.length) {
          const escaped = source.startsWith('\\u', offset);
          const next = escaped ? escape() : String.fromCodePoint(source.codePointAt(offset));
          const valid = value ? /[\p{ID_Continue}$\u200c\u200d]/u : /[\p{ID_Start}_$]/u;
          if (!valid.test(next)) { if (escaped) fail('Invalid identifier escape'); break; }
          value += next;
          if (!escaped) offset += next.length;
        }
        const property = punctuation(tokens.at(-1), '.', '?.');
        add('identifier', value, start);
        expressionStart = !property && /^(?:return|throw|case|delete|void|typeof|new|in|instanceof|yield|await|else|do)$/.test(value);
        continue;
      }
      if (/\d/.test(char)) {
        const start = offset++;
        while (/[\w.]/.test(source[offset] ?? '')) offset++;
        add('number', source.slice(start, offset), start);
        expressionStart = false;
        continue;
      }
      const previous = tokens.at(-1);
      const propertyCall = punctuation(tokens.at(-2), '.', '?.');
      const value = ['?.', '++', '--', '=>'].find(value => source.startsWith(value, offset)) ?? char;
      add('punctuation', value);
      offset += value.length;
      if (char === '(') parentheses.push(!propertyCall && previous?.type === 'identifier' && /^(?:if|while|for|with|switch|catch)$/.test(previous.value));
      if (char === '{') braces++;
      if (char === '}') {
        if (templateExpression && braces === 0) return;
        braces--;
      }
      // After a closing brace, prefer division. An ambiguous regex can produce a
      // conservative rejection, but must never hide an import in a division.
      expressionStart = char === ')' ? parentheses.pop() === true : !['}', ']', '.', '?.', '++', '--'].includes(value);
    }
    if (templateExpression) fail('Unterminated template expression');
  };
  code();
  return tokens;
}

export function inspectModuleImports(source, filename = '<source>') {
  const tokens = sourceTokens(source, filename);
  const imports = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier' || !['import', 'export'].includes(token.value)) continue;
    if (punctuation(tokens[index - 1], '.', '?.')) continue;
    const next = tokens[index + 1];
    if (token.value === 'import' && punctuation(next, '(')) {
      const literal = tokens[index + 2];
      const end = index + (literal?.type === 'template' ? 4 : 3);
      if (!['string', 'template'].includes(literal?.type) || literal.value === null || !punctuation(tokens[end], ')', ',')) {
        const line = source.slice(0, token.start).split('\n').length;
        throw new SyntaxError(`${filename}:${line}: Nonliteral dynamic import cannot be checked; use a literal module specifier`);
      }
      imports.push(literal.value);
    } else if (token.value === 'import' && next?.type === 'string') {
      imports.push(next.value);
    } else if ((token.value === 'import' && !punctuation(next, '.', ':')) || (token.value === 'export' && punctuation(next, '{', '*'))) {
      // Static import/export clauses cannot contain expressions. Stop after the
      // binding list instead of wandering into strings in a later declaration.
      let cursor = index + 1;
      if (punctuation(tokens[cursor], '{')) {
        while (tokens[cursor] && !punctuation(tokens[cursor], '}')) cursor++;
        cursor++;
      } else if (punctuation(tokens[cursor], '*')) {
        cursor++;
        if (tokens[cursor]?.value === 'as') cursor += 2;
      } else {
        cursor++;
        if (punctuation(tokens[cursor], ',')) {
          cursor++;
          if (punctuation(tokens[cursor], '*')) cursor += 3;
          else if (punctuation(tokens[cursor], '{')) {
            while (tokens[cursor] && !punctuation(tokens[cursor], '}')) cursor++;
            cursor++;
          }
        }
      }
      if (tokens[cursor]?.type === 'identifier' && tokens[cursor].value === 'from' && tokens[cursor + 1]?.type === 'string') imports.push(tokens[cursor + 1].value);
    }
  }
  return imports;
}

export function resolveModuleImport(root, file, specifier) {
  if (specifier.startsWith('//')) throw new Error(`Unsupported module URL ${specifier} in ${relative(root, file)}`);
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    if (/^(?!node:)[a-z][\w+.-]*:/i.test(specifier)) throw new Error(`Unsupported module URL ${specifier} in ${relative(root, file)}`);
    return null;
  }
  const base = specifier.startsWith('/') ? resolve(root, 'index.mjs') : file;
  const target = fileURLToPath(new URL(specifier.startsWith('/') ? `.${specifier}` : specifier, pathToFileURL(base)));
  const local = relative(root, target);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error(`${relative(root, file)} imports outside repository: ${specifier}`);
  if (local.startsWith(`vendor${sep}`)) return null;
  let regularFile = false;
  try { regularFile = lstatSync(target).isFile(); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  if (!regularFile) throw new Error(`${relative(root, file)} has missing import ${specifier}`);
  if (realpathSync(target) !== target) throw new Error(`${relative(root, file)} imports through a symlink: ${specifier}`);
  return target;
}

export function validateModuleGraph(root, layers = MODULE_LAYERS) {
  root = resolve(root);
  const files = discoverModuleFiles(root, layers);
  const checked = new Set(files);
  const edges = new Map(Object.keys(layers).map(layer => [layer, new Set()]));
  const layerOf = file => relative(root, file).split(sep)[0];
  for (const file of files) {
    const owner = layerOf(file);
    for (const specifier of inspectModuleImports(readFileSync(file, 'utf8'), relative(root, file))) {
      const target = resolveModuleImport(root, file, specifier);
      if (!target) continue;
      const dependency = layerOf(target);
      if (dependency !== owner && !layers[owner].includes(dependency)) throw new Error(`${owner} must not depend on ${dependency}: ${relative(root, file)}`);
      if (!checked.has(target)) throw new Error(`${relative(root, file)} imports module outside checked sources: ${specifier}`);
      if (dependency !== owner) edges.get(owner).add(dependency);
    }
  }
  const visited = new Set();
  const visit = (layer, path) => {
    if (path.includes(layer)) throw new Error(`Module dependency cycle: ${[...path, layer].join(' → ')}`);
    if (visited.has(layer)) return;
    for (const dependency of edges.get(layer)) visit(dependency, [...path, layer]);
    visited.add(layer);
  };
  for (const layer of Object.keys(layers)) visit(layer, []);
  return { files, edges };
}
