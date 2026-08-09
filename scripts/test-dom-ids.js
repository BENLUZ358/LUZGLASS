#!/usr/bin/env node
/**
 * Every getElementById('x') in a page must have a matching id="x" in it.
 *
 * This exists because of a real regression. Adding skip-link targets, an
 * element that already carried id="filtersBar" was given id="csMain" instead —
 * an element can only have one id, so the old one was destroyed. showSketch()
 * then threw on a null element and sketches stopped rendering in the check
 * station, with nothing to suggest the cause was an accessibility change.
 *
 * Ids created at runtime are unavoidable in a codebase that builds most of its
 * markup from JS, so an id is accepted if it appears anywhere in the file as
 * id="x" or id='x' or id=`x`, including inside a template literal.
 *
 * Run: node scripts/test-dom-ids.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const PAGES = ['admin.html', 'portal.html', 'workday.html', 'check-station.html',
               'drafter.html', 'mekhlahon.html', 'new-order.html', 'order-view.html',
               'upload.html', 'sketch-demo.html', 'login.html'];

let failed = 0;

for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');

  /* every id this file ever defines, static markup or generated */
  const defined = new Set([...html.matchAll(/\bid\s*=\s*["'`]([^"'`\s]+)["'`]/g)].map(m => m[1]));
  /* ids assigned imperatively: el.id = 'x' */
  [...html.matchAll(/\.id\s*=\s*['"`]([^'"`]+)['"`]/g)].forEach(m => defined.add(m[1]));

  /* Only literal lookups can be checked — a variable could be anything.
     A lookup dereferenced on the spot, getElementById('x').style, throws the
     moment x is missing and takes the rest of the handler with it. One stored
     in a variable is nearly always followed by an `if (el)`, which is a
     legitimate pattern for an element that exists only in some modes. So the
     first is a failure and the second is a note. */
  const looked  = [...new Set([...html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]))];
  const chained = [...new Set([...html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)\s*[.[]/g)].map(m => m[1]))];

  const missing  = looked.filter(id => !defined.has(id));
  const willThrow = missing.filter(id => chained.includes(id));
  const guarded   = missing.filter(id => !chained.includes(id));

  if (willThrow.length) {
    failed++;
    console.error(`FAIL  ${page}: ${willThrow.length} id(s) dereferenced but never defined`);
    willThrow.forEach(id => {
      const line = html.slice(0, html.search(new RegExp(`getElementById\\(\\s*['"]${id}['"]`))).split('\n').length;
      console.error(`        #${id}  around line ${line} — this throws`);
    });
  } else {
    console.log(`ok    ${page}  ${looked.length} ids, none dereferenced unsafely`);
  }
  if (guarded.length) {
    console.log(`      note: ${guarded.length} looked up but never defined, all stored first: ${guarded.join(', ')}`);
  }

  /* a duplicate id is legal HTML but getElementById returns only the first,
     which is its own quiet source of "why is this element not updating" */
  const all = [...html.matchAll(/\bid\s*=\s*["']([^"'\s]+)["']/g)].map(m => m[1]);
  const dupes = [...new Set(all.filter((id, i) => all.indexOf(id) !== i))]
    .filter(id => looked.includes(id));
  if (dupes.length) {
    failed++;
    console.error(`FAIL  ${page}: id(s) defined twice and looked up: ${dupes.join(', ')}`);
  }
}

if (failed) { console.error(`\n${failed} page(s) with id problems.`); process.exit(1); }
console.log('\nAll DOM id references resolve.');
