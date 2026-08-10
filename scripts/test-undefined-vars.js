#!/usr/bin/env node
/**
 * Finds identifiers a page uses but never declares.
 *
 * These pages have no build step and no linter, so nothing checks this. A
 * refactor deleted `const fullGlass = ...` because the filter that used it had
 * moved elsewhere — but a line further down still rendered fullGlass. Syntax
 * was fine, every test passed, and the whole of workday.html died on
 * ReferenceError the moment an order was available to show. The page never got
 * past its loading spinner.
 *
 * This walks each page's inline scripts with a real parser, builds the scope
 * chain, and reports every free identifier that is neither a browser global nor
 * declared by one of the project's own scripts.
 *
 * Run: node scripts/test-undefined-vars.js
 */

const fs     = require('fs');
const path   = require('path');
const acorn  = require('acorn');
const walk   = require('acorn-walk');

const ROOT  = path.join(__dirname, '..');
const PAGES = ['workday.html', 'check-station.html', 'admin.html', 'portal.html',
               'drafter.html', 'upload.html', 'new-order.html', 'login.html',
               'mekhlahon.html'];
const SHARED = ['firebase-db.js', 'lg-icons.js'];

/* Anything the browser, Firebase or our own shared scripts provide. */
const GLOBALS = new Set([
  // language
  'globalThis','undefined','NaN','Infinity','Object','Array','String','Number','Boolean',
  'Math','JSON','Date','RegExp','Error','TypeError','Map','Set','WeakMap','WeakSet',
  'Promise','Symbol','Proxy','Reflect','BigInt','Intl','parseInt','parseFloat','isNaN',
  'isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','escape','unescape',
  // browser
  'window','document','console','location','history','navigator','localStorage','sessionStorage',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'cancelAnimationFrame','alert','confirm','prompt','fetch','FormData','Headers','Request',
  'Response','URL','URLSearchParams','Blob','File','FileReader','Image','Audio','Canvas',
  'HTMLElement','Element','Node','Event','CustomEvent','MutationObserver','IntersectionObserver',
  'ResizeObserver','XMLHttpRequest','AbortController','TextEncoder','TextDecoder','structuredClone',
  'getComputedStyle','matchMedia','scrollTo','open','close','print','btoa','atob','crypto',
  'performance','screen','frames','self','top','parent','onerror','queueMicrotask','DOMParser',
  // libraries loaded by <script src>
  'firebase','html2canvas','jspdf','XLSX',
]);

let failed = 0;
const report = [];

/* Collect every name any project script declares at any scope. A name declared
   in one file and used in another is normal here — the pages share globals via
   plain <script> tags — so the check is "declared nowhere at all". */
function declaredNames(src) {
  const names = new Set();
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest' }); } catch { return names; }
  const addPattern = (node) => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':        names.add(node.name); break;
      case 'ObjectPattern':     node.properties.forEach(p => addPattern(p.value || p.argument)); break;
      case 'ArrayPattern':      node.elements.forEach(addPattern); break;
      case 'AssignmentPattern': addPattern(node.left); break;
      case 'RestElement':       addPattern(node.argument); break;
    }
  };
  walk.full(ast, (node) => {
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
          || node.type === 'ArrowFunctionExpression' || node.type === 'ClassDeclaration') {
      if (node.id) names.add(node.id.name);
      (node.params || []).forEach(addPattern);
    } else if (node.type === 'CatchClause') addPattern(node.param);
    else if (node.type === 'ImportDefaultSpecifier' || node.type === 'ImportSpecifier') addPattern(node.local);
    /* window.foo = … / global.foo = … creates a real global — that is how
       lg-icons.js publishes lgIcons, and the bare name then resolves. */
    else if (node.type === 'AssignmentExpression'
          && node.left.type === 'MemberExpression' && !node.left.computed
          && node.left.object.type === 'Identifier'
          && ['window', 'global', 'globalThis', 'self'].includes(node.left.object.name)
          && node.left.property.type === 'Identifier') {
      names.add(node.left.property.name);
    }
  });
  return names;
}

/* every name declared anywhere in the project's own scripts */
const projectNames = new Set();
for (const f of SHARED) {
  try { declaredNames(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach(n => projectNames.add(n)); }
  catch { /* optional file */ }
}

const inlineScripts = (html) => {
  const out = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push({ code: m[1], offset: html.slice(0, m.index).split('\n').length });
  return out;
};

/* Free identifiers: referenced but bound by no enclosing scope in this script. */
function freeIdentifiers(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  const free = [];
  const scopes = [new Set()];
  const bound  = (n) => scopes.some(s => s.has(n));

  /* hoist every declaration in the script into one flat set — these pages rely
     on hoisting and on cross-<script> globals, so per-block precision would
     only produce noise. What matters is a name bound NOWHERE. */
  const all = declaredNames(src);
  scopes[0] = all;

  /* A name the script itself probes with `typeof x === 'function'` is optional
     on purpose — unavResetAll calls resetAllOrders only when it exists, which
     is legal and deliberate. Probing it anywhere excuses its call sites. */
  const probed = new Set();
  walk.full(ast, (node) => {
    if (node.type === 'UnaryExpression' && node.operator === 'typeof'
        && node.argument.type === 'Identifier') probed.add(node.argument.name);
  });

  walk.ancestor(ast, {
    Identifier(node, _state, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;
      /* skip positions that are not variable reads */
      if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
      if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
      if (parent.type === 'MethodDefinition' && parent.key === node) return;
      if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement'
       || parent.type === 'ContinueStatement') return;
      /* typeof x is legal on a name that does not exist and is the standard
         way these pages probe for an optional function. */
      if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return;
      if (bound(node.name) || GLOBALS.has(node.name) || projectNames.has(node.name)
       || probed.has(node.name)) return;
      free.push({ name: node.name, line: src.slice(0, node.start).split('\n').length });
    },
  });
  return free;
}

for (const page of PAGES) {
  let html;
  try { html = fs.readFileSync(path.join(ROOT, page), 'utf8'); } catch { continue; }
  const blocks = inlineScripts(html);

  /* Separate <script> blocks on one page share the global scope, so a name
     declared in the first and used in the third is perfectly normal. Gather
     the whole page's declarations before checking any block. */
  const pageNames = new Set();
  for (const { code } of blocks) declaredNames(code).forEach(n => pageNames.add(n));

  const hits = [];
  for (const { code, offset } of blocks) {
    let found;
    try { found = freeIdentifiers(code); }
    catch (e) { hits.push({ name: 'PARSE ERROR: ' + e.message, line: offset }); continue; }
    for (const f of found) {
      if (pageNames.has(f.name)) continue;
      hits.push({ name: f.name, line: offset + f.line - 1 });
    }
  }
  /* dedupe by name, keep the first line */
  const seen = new Map();
  for (const h of hits) if (!seen.has(h.name)) seen.set(h.name, h.line);

  if (seen.size) {
    failed++;
    report.push(`FAIL  ${page}`);
    for (const [name, line] of seen) report.push(`        ${name}  — ${page}:${line}`);
  } else {
    report.push(`ok    ${page}`);
  }
}

/* ── prove the scanner still catches the bug it was written for ────────
   A check that cannot fail is worth nothing. This is the exact shape of the
   regression: a declaration deleted, its use left behind inside a template
   literal, syntax perfectly valid. */
{
  const bug = `
    function orderCardHTML(o){
      return (o.items||[]).map(grp => {
        const it = grp.rep;
        return '<div>' + lgEsc(fullGlass) + '</div>';
      }).join('');
    }
    function lgEsc(s){ return s; }`;
  const found = freeIdentifiers(bug).map(f => f.name);
  if (!found.includes('fullGlass')) {
    console.error('FAIL  the scanner no longer detects a deleted declaration');
    process.exit(1);
  }
  const clean = bug.replace('const it = grp.rep;', 'const it = grp.rep; const fullGlass = it.name;');
  if (freeIdentifiers(clean).length) {
    console.error('FAIL  the scanner reports a false positive on correct code:',
                  freeIdentifiers(clean).map(f => f.name).join(', '));
    process.exit(1);
  }
  console.log('ok    the scanner catches a deleted declaration, and passes correct code');
}

console.log(report.join('\n'));

if (failed) {
  console.error(`\n${failed} page(s) reference names that are declared nowhere.`);
  console.error('Each one throws ReferenceError the moment that line runs.');
  process.exit(1);
}
console.log('\nNo undefined identifiers.');
