var fs = require('fs');
var path = require('path');
var L = require('./helpers/load.js');
var SGB = L.loadSGB(['checker-core.js', 'xlsx-parse.js', 'writeback.js']);
var XLSX = globalThis.XLSX;
var FIX = path.join(__dirname, 'fixtures');

var fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) fail++;
}
function read(name) {
  return XLSX.read(fs.readFileSync(path.join(FIX, name)), { type: 'buffer' });
}

console.log('=== plan — 표준 그리드는 셀 주소를 찾는다 ===');
var p = SGB.writeback.plan(read('standard.xlsx'));
ok(p.ok === true, 'ok === true');
ok(p.format === 'standard', "format === 'standard' (실제: " + p.format + ')');
ok(p.cells.length === 3, '세특 셀 3개 (실제: ' + p.cells.length + ')');
ok(p.cells[0].addr === 'G2', "첫 셀 G2 (실제: " + p.cells[0].addr + ')');
ok(p.cells[0].name === '김서연' && p.cells[0].subject === '국어', '첫 셀 = 김서연/국어');
ok(p.cells[2].subject === '수학', '과목 forward-fill 반영 (실제: ' + p.cells[2].subject + ')');

console.log('=== plan — 인쇄덤프는 거부한다 ===');
var pd = SGB.writeback.plan(read('printdump.xlsx'));
ok(pd.ok === false, 'ok === false');
ok(typeof pd.reason === 'string' && pd.reason.length > 0, '거부 이유 문자열 있음 (' + pd.reason + ')');

console.log('=== plan — 창체 번들도 셀을 찾는다 ===');
var pc = SGB.writeback.plan(read('club.xlsx'));
ok(pc.ok === true, '창체 ok === true');
ok(pc.cells.length === 2, '학생 2명 (실제: ' + pc.cells.length + ')');
ok(pc.cells[0].name === '김서연', '첫 학생 김서연 (실제: ' + pc.cells[0].name + ')');

console.log('=== build — 세특 셀만 바뀌고 구조는 보존된다 ===');
var wb = read('standard.xlsx');
var before = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
var out = SGB.writeback.build(wb, { 'G2': '자료를 정리하고 포털사이트 문서로 작성함.' });
var wb2 = XLSX.read(out, { type: 'array' });
var after = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '' });

ok(JSON.stringify(before[0]) === JSON.stringify(after[0]), '헤더행 보존');
ok(before.length === after.length, '행 수 보존 ' + before.length + '→' + after.length);
ok(after[1][6] === '자료를 정리하고 포털사이트 문서로 작성함.', '대상 셀 교체됨');
ok(JSON.stringify(before[2]) === JSON.stringify(after[2]), '나머지 행 무변');

console.log('=== build — 결과가 원본 파서로 다시 읽힌다 (NEIS 양식 유지) ===');
var SGB2 = L.loadSGB(['xlsx-parse.js']);
var re = SGB2.parse.parseWorkbook(wb2, { fileName: 'out.xlsx' });
ok(re.format === 'standard', '재파싱 format standard (실제: ' + re.format + ')');
ok(re.students.length === 3, '재파싱 행 3개 (실제: ' + re.students.length + ')');

console.log('=== build — 원본 워크북을 오염시키지 않는다 ===');
var wb3 = read('standard.xlsx');
SGB.writeback.build(wb3, { 'G2': 'XXX' });
var chk = XLSX.utils.sheet_to_json(wb3.Sheets[wb3.SheetNames[0]], { header: 1, defval: '' });
ok(chk[1][6].indexOf('XXX') === -1, '원본 워크북 무변 (실제: ' + chk[1][6].slice(0, 12) + ')');

console.log('\n' + (fail ? '★ 실패 ' + fail + '건' : '★ 전체 통과'));
process.exit(fail ? 1 : 0);
