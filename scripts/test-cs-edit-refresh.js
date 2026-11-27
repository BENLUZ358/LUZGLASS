#!/usr/bin/env node
/** תחנת בדיקה — עריכה שנשמרה חייבת להופיע בסקיצה (בן 27/11). Run: node scripts/test-cs-edit-refresh.js
 *  שורש התקלה: (1) שתי טעינות של renderSketch — הישנה שנגמרה אחרונה דרסה את החדשה;
 *  (2) עותק מקומי ישן של הציור נשאר כשהדפדפן התמלא (safeStorage בולע את השגיאה).
 *  נבדק בדפדפן מול הגרסה הקודמת (שם הוצג הציור הישן). כאן — שהשמירות במקומן. */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'check-station.html'), 'utf8');
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const body = (name) => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); };

const rs = body('renderSketch');
ok('renderSketch numbers each call', /const seq = \+\+_csSkSeq/.test(rs));
ok('a stale load does not draw (then + catch)', (rs.match(/seq!==_csSkSeq/g) || []).length === 2);
ok('the edit is read when drawing, not when calling', /const ed = editedNow\(\)/.test(rs) && !/_showSketchImg\(el, liveEdited/.test(rs));
const st = body('_csStoreEdits');
ok('local copy written straight to localStorage (safeStorage swallows quota errors)', /localStorage\.setItem\('lgCSEdits'/.test(st));
ok('full storage → old copy removed', /localStorage\.removeItem\('lgCSEdits'\)/.test(st));
ok('every write of the local copy goes through _csStoreEdits', !/safeStorage\.setItem\('lgCSEdits'/.test(src));
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
