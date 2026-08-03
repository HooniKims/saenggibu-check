var fs = require('fs');
var path = require('path');
var vm = require('vm');
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
function mkSheet(rows) {
  var b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), 'S');
  return XLSX.read(XLSX.write(b, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
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

console.log('=== build — 시트에 없는 주소는 조용히 버리지 않고 던진다 ===');
var threw = false;
try { SGB.writeback.build(read('standard.xlsx'), { 'Z99': 'x' }); }
catch (e) { threw = true; ok(e.message.indexOf('Z99') !== -1, '오류 메시지에 주소가 있음 (' + e.message + ')'); }
ok(threw, '존재하지 않는 주소면 throw');

console.log('=== plan — 단일행 창체는 계속 동작한다 ===');
var pc2 = SGB.writeback.plan(read('club.xlsx'));
ok(pc2.ok === true && pc2.cells.length === 2, 'club.xlsx 여전히 2건 (실제 ok=' + pc2.ok + ' n=' + pc2.cells.length + ')');

console.log('=== 워크백 왕복 — 리더가 보는 텍스트와 쓴 텍스트가 같다 ===');
function roundTrip(rows, edit) {
  var wb = mkSheet(rows);
  var p = SGB.writeback.plan(wb);
  var reps = {};
  p.cells.forEach(function (c) { reps[c.addr] = edit(c.text); });
  var out = SGB.writeback.build(wb, reps, p);
  var wb2 = XLSX.read(out, { type: 'array' });
  return { plan: p, after: SGB.writeback.plan(wb2) };
}
var STD_H = ['학년도', '학기', '과목', '과목코드', '반/번호', '성명', '세부능력 및 특기사항'];

var rt1 = roundTrip([STD_H,
  ['2025', '1', '국어', 'K', '3/1', '김서연', '정리함.'],
  ['', '', '', '', '', '', '그리고 추가로 이런 부분도 잘함.']], function (t) { return t; });
ok(rt1.after.cells.length === rt1.plan.cells.length,
   '연속행 왕복 후 학생 수 동일 (' + rt1.plan.cells.length + '→' + rt1.after.cells.length + ')');
ok(rt1.after.cells[0].text === rt1.plan.cells[0].text,
   '텍스트 중복 없음 (실제: ' + JSON.stringify(rt1.after.cells[0].text) + ')');

var rt2 = roundTrip([STD_H,
  ['2025', '1', '국어', 'K', '3/1', '김서연', '자료를 정리함.'],
  ['', '', '', '', '3/2', '박도윤', '토론에 참여함.'],
  ['', '', '', '', '', '', '이상 담임교사 확인']], function (t) { return t; });
ok(rt2.after.cells.length === 2 && rt2.after.cells[1].text === rt2.plan.cells[1].text,
   '꼬리말 왕복 안정 (실제: ' + JSON.stringify(rt2.after.cells[1] && rt2.after.cells[1].text) + ')');

console.log('=== 워크백 왕복 — 다중행 창체 번들도 이제 거부 대신 왕복된다 ===');
var rt3 = roundTrip([
  ['2025학년도 진로활동 학생부 자료기록'], [''],
  ['번호', '성명', '학년', '특기사항', '희망분야'],
  ['1', '김서연', '3', '희망분야', '컴퓨터공학'],
  ['', '', '', '진로 탐색 활동에서 학과를 조사하였다.', ''],
  ['', '', '', '발표 자료를 제작했고 공유함.', '']
], function (t) { return t; });
ok(rt3.plan.ok === true, '다중행 번들도 plan.ok === true (실제: ' + rt3.plan.ok + ')');
ok(rt3.after.cells.length === rt3.plan.cells.length,
   '왕복 후 학생 수 동일 (' + rt3.plan.cells.length + '→' + rt3.after.cells.length + ')');
ok(rt3.after.cells[0] && rt3.after.cells[0].text === rt3.plan.cells[0].text,
   '왕복 후 텍스트 중복 없음 (실제: ' + JSON.stringify(rt3.after.cells[0] && rt3.after.cells[0].text) + ')');

console.log('=== plan 이 리더와 같은 텍스트를 본다 ===');
[['standard.xlsx'], ['club.xlsx']].forEach(function (f) {
  var wb4 = read(f[0]);
  var pl = SGB.writeback.plan(wb4);
  var rd = SGB.parse.parseWorkbook(wb4, { fileName: f[0] });
  var rdText = [];
  (rd.students || []).forEach(function (s) {
    (s.entries || []).forEach(function (e) { if (e.text) rdText.push(e.text); });
  });
  ok(JSON.stringify(pl.cells.map(function (c) { return c.text; })) === JSON.stringify(rdText),
     f[0] + ' plan 텍스트 === 리더 텍스트');
});

console.log('=== 창체 번들 감지 — work-app.js 와 career-app.js 가 일치한다 (Finding 8) ===');
(function () {
  // work-app.js 의 isCareerBundleWorkbook 은 (Finding 8 조치로) document 가드보다
  // 앞에 정의돼 있고 SGB.workApp 에 노출돼 있어 Node 에서도 그대로 부를 수 있다.
  L.loadSGB(['work-app.js']);
  var workAppDetect = globalThis.SGB.workApp && globalThis.SGB.workApp.isCareerBundleWorkbook;
  ok(typeof workAppDetect === 'function', 'SGB.workApp.isCareerBundleWorkbook 이 Node 에서도 노출됨');

  // career-app.js 는 window.SGB·document 를 직접 참조하는 DOM 의존 모듈이라
  // Node 에서 통째로 로드할 수 없다. 손으로 조건을 다시 베끼면 원본이 바뀔 때
  // 조용히 어긋날 수 있으므로, isCareerBundleFormat 함수의 실제 소스를 파일에서
  // 그대로 잘라내 격리된 컨텍스트에서 평가한다 — 로직을 옮겨 적지 않는다.
  function extractFunctionSource(filePath, fnName) {
    var src = fs.readFileSync(filePath, 'utf8');
    var re = new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{');
    var m = re.exec(src);
    if (!m) throw new Error('extractFunctionSource: ' + fnName + ' 를 ' + filePath + ' 에서 찾지 못함');
    var i = m.index + m[0].length;
    var depth = 1;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    return src.slice(m.index, i);
  }

  var careerAppPath = path.join(__dirname, '../assets/js/career-app.js');
  var careerSrc = extractFunctionSource(careerAppPath, 'isCareerBundleFormat');
  var isCareerBundleFormat = vm.runInNewContext('(' + careerSrc + ')');
  ok(typeof isCareerBundleFormat === 'function', 'career-app.js:347 isCareerBundleFormat 소스를 그대로 추출함');

  ['career-bundle.xlsx', 'club.xlsx', 'standard.xlsx', 'printdump.xlsx'].forEach(function (name) {
    var wb = read(name);
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    var fromCareerApp = isCareerBundleFormat(rows);
    var fromWorkApp = workAppDetect(wb);
    ok(fromCareerApp === fromWorkApp,
       name + ' 판정 일치 (career-app=' + fromCareerApp + ', work-app=' + fromWorkApp + ')');
  });

  ok(workAppDetect(read('career-bundle.xlsx')) === true,
     'career-bundle.xlsx 는 두 판별 함수 모두 번들 형식으로 감지한다');
})();

console.log('\n' + (fail ? '★ 실패 ' + fail + '건' : '★ 전체 통과'));
process.exit(fail ? 1 : 0);
