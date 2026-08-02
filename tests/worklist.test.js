// localStorage 가 없는 Node 환경이므로 최소 구현을 심는다.
var store = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

var L = require('./helpers/load.js');
var SGB = L.loadSGB(['checker-core.js', 'worklist.js']);

var fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) fail++;
}

console.log('=== key — 번호|성명|과목, 공백 제거 ===');
ok(SGB.worklist.key(' 3/1 ', '김서연', '국어') === '3/1|김서연|국어',
   '실제: ' + SGB.worklist.key(' 3/1 ', '김서연', '국어'));
ok(SGB.worklist.key('1', '김서연', '') === '1|김서연|', '과목 없으면 빈 문자');

console.log('=== 기본값 ===');
var k = SGB.worklist.key('3/1', '김서연', '국어');
ok(SGB.worklist.get(k).done === false, '처음엔 done false');
ok(JSON.stringify(SGB.worklist.get(k).edits) === '{}', '처음엔 edits 비어 있음');

console.log('=== 완료 표시와 저장 ===');
SGB.worklist.setDone(k, true);
ok(SGB.worklist.get(k).done === true, 'done true 로 바뀜');
ok(store['sgb_worklist_v1'] !== undefined, 'localStorage 에 저장됨');

console.log('=== 다시 로드해도 유지된다 ===');
delete globalThis.SGB.worklist;
L.loadSGB(['worklist.js']);
ok(globalThis.SGB.worklist.get(k).done === true, '재로드 후에도 done true');

console.log('=== edits — 기본값에서 벗어난 것만 저장 ===');
SGB.worklist.setEdit(k, 3, false);
ok(SGB.worklist.get(k).edits['3'] === false, 'edits[3] === false');
var saved = JSON.parse(store['sgb_worklist_v1']);
ok(Object.keys(saved[k].edits).length === 1, '저장된 edits 는 1건만 (실제: ' + Object.keys(saved[k].edits).length + ')');

console.log('=== progress ===');
var keys = [k, SGB.worklist.key('3/2', '박도윤', '국어'), SGB.worklist.key('3/1', '김서연', '수학')];
var pr = SGB.worklist.progress(keys);
ok(pr.done === 1 && pr.total === 3, '1/3 (실제: ' + pr.done + '/' + pr.total + ')');

console.log('=== picks — 선택한 대체어를 값으로 보존한다 ===');
SGB.worklist.setPick(k, 5, '영상 창작자');
ok(SGB.worklist.get(k).picks['5'] === '영상 창작자', 'picks 저장 (실제: ' + JSON.stringify(SGB.worklist.get(k).picks) + ')');
delete globalThis.SGB.worklist;
L.loadSGB(['worklist.js']);
ok(globalThis.SGB.worklist.get(k).picks['5'] === '영상 창작자', '재로드 후에도 유지');

console.log('=== picks — 이전 스키마(picks 없음) 호환 ===');
store['sgb_worklist_v1'] = JSON.stringify({ 'old|기록|국어': { done: true, edits: { '1': false } } });
delete globalThis.SGB.worklist;
L.loadSGB(['worklist.js']);
var old = globalThis.SGB.worklist.get('old|기록|국어');
ok(old.done === true && JSON.stringify(old.picks) === '{}', '옛 기록도 안전하게 읽힘');

console.log('=== picks + edits — 해제가 선택보다 우선한다 ===');
SGB.worklist.setPick(k, 5, '영상 창작자');
SGB.worklist.setEdit(k, 5, false);
var st = SGB.worklist.get(k);
ok(st.picks['5'] === '영상 창작자', '고른 값은 남아 있다');
ok(st.edits['5'] === false, '해제 상태도 남아 있다');

console.log('=== reset ===');
SGB.worklist.reset();
ok(SGB.worklist.get(k).done === false, 'reset 후 done false');

console.log('\n' + (fail ? '★ 실패 ' + fail + '건' : '★ 전체 통과'));
process.exit(fail ? 1 : 0);
