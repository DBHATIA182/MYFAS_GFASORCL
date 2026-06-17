const fs = require('fs');
const t = fs.readFileSync('E:/GFASORCL/APPTEST/VFP-IMPORT/stktrf.SCT').toString('latin1');
const clean = t.replace(/[^\x20-\x7E\n]/g, '.');
let idx = 0;
let count = 0;
while ((idx = clean.indexOf('PROCEDURE', idx)) >= 0 && count < 8) {
  console.log('--- PROCEDURE', count, '---');
  console.log(clean.slice(idx, idx + 2500));
  idx += 9;
  count += 1;
}
