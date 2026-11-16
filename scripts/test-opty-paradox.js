#!/usr/bin/env node
/**
 * opty-paradox.js — קריאת טבלת החלקים של אופטי-ווי (בן, 16/11).
 * הקובץ לדוגמה = בלוק אחד מתוך Pezzi.DB האמיתי (16/11).
 * Run: node scripts/test-opty-paradox.js
 */
const fs = require('fs'), path = require('path');
const { lgOptyReadTable } = require('../opty-paradox.js');
let failed = 0;
const check = (name, a, e) => JSON.stringify(a) === JSON.stringify(e) ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

const t = lgOptyReadTable(fs.readFileSync(path.join(__dirname, 'fixtures', 'opty-Pezzi-sample.DB')));
check('55 fields, SAGOMA among them', [t.fields.length, t.fields.some(f => f.name === 'SAGOMA')], [55, true]);
const r = t.rows.find(x => x.SAGOMA === '274328');
check('shape 274328 as on the OptyWay screen', r && [r.CLIENTE, r.ORDINE, r.DIMXPZ, r.DIMYPZ, r.CODCOM, r.COD_MAT_COMP, r.NOTE, r.QTAPZ, r.DATACONS],
  ['BathPlace', 'איציק', 502, 1902, 'M00291', '08S', 'חיסום/חור', 1, '2026-11-12']);
check('every row has a work order', t.rows.every(x => /^[MP]\d+/.test(x.CODCOM)), true);
let threw = '';
try { lgOptyReadTable(new Uint8Array(50)); } catch (e) { threw = e.message; }
check('a non-OptyWay file is refused with a Hebrew message', /אופטי-ווי/.test(threw), true);
if (failed) { console.error(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
