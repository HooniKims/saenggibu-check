var L = require('./helpers/load.js');
var SGB = L.loadSGB(['checker-core.js', 'rules-subject.js', 'rules-career.js', 'suggest.js']);
var RS = SGB.rulesSubject;

var fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) fail++;
}
function sug(text) {
  return SGB.suggest.build(text, RS.scan(text, { id: 'general', byteLimit: 1500 }));
}
function find(list, rule) {
  return list.filter(function (s) { return s.rule === rule; })[0];
}

console.log('=== 유의어 — 후보 1개면 safe, 기본 체크 ===');
var s1 = find(sug('구글 문서로 작성함'), 'N1기재유의어');
ok(!!s1, '유의어 제안 생성됨');
ok(s1 && s1.kind === 'safe', "kind === 'safe' (실제: " + (s1 && s1.kind) + ')');
ok(s1 && s1.to === '포털사이트', "to === '포털사이트' (실제: " + (s1 && s1.to) + ')');
ok(s1 && s1.on === true, '기본 체크됨');

console.log('=== 유의어 — 후보 여러 개면 choice, 기본 해제 ===');
var s2 = find(sug('유튜브 영상을 제작함'), 'N1기재유의어');
ok(s2 && s2.kind === 'choice', "kind === 'choice' (실제: " + (s2 && s2.kind) + ')');
ok(s2 && s2.to === null, 'to 는 null (교사가 고름)');
ok(s2 && s2.on === false, '기본 해제됨');
ok(s2 && JSON.stringify(s2.alts) === JSON.stringify(['동영상 플랫폼', '영상 창작자']),
   'alts 분리됨 (실제: ' + (s2 && JSON.stringify(s2.alts)) + ')');

console.log('=== from 은 span 슬라이스여야 한다 (quote 아님) ===');
var s3 = find(sug('자료·발표를 정리함'), 'R2특수기호');
ok(s3 && s3.from === '·', "from === '·' — quote 였다면 문장 전체 (실제: " + (s3 && JSON.stringify(s3.from)) + ')');

console.log('=== 특수기호는 manual — 자동 치환하지 않는다 ===');
ok(s3 && s3.kind === 'manual', "kind === 'manual' (실제: " + (s3 && s3.kind) + ')');
ok(s3 && s3.to === null, 'to 는 null');

console.log('=== 굽은 따옴표 → 곧은 따옴표 ===');
var q = sug('‘토지’를 읽음').filter(function (s) { return s.rule === 'R9줄바꿈도서명'; });
ok(q.length === 2, '여는·닫는 따옴표 2건 (실제: ' + q.length + ')');
ok(q.every(function (s) { return s.kind === 'safe' && s.to === "'"; }), "둘 다 safe, to === \"'\"");

console.log('=== 겹화살괄호 → 작은따옴표 ===');
var b = sug('『토지』를 읽음').filter(function (s) { return s.rule === 'R9줄바꿈도서명'; });
ok(b.length === 2 && b.every(function (s) { return s.to === "'"; }), '『』 둘 다 → 작은따옴표');

console.log('=== 줄바꿈 → 공백 ===');
var n = find(sug('앞줄\n뒷줄'), 'R9줄바꿈도서명');
ok(n && n.kind === 'safe' && n.to === ' ', '줄바꿈 → 공백 1칸');

console.log('=== 괄호 안 영문 제거 ===');
var p = find(sug('반론(counterargument)을 포함함'), 'N2괄호영문');
ok(p && p.kind === 'safe' && p.to === '반론', "to === '반론' (실제: " + (p && p.to) + ')');

console.log('=== 분량 초과(span 0폭)는 제안 대상이 아니다 ===');
var over = sug('가'.repeat(600)).filter(function (s) { return s.rule === 'R10분량'; });
ok(over.length === 0, 'R10 은 제안 목록에서 제외 (실제: ' + over.length + '건)');

console.log('=== 창체 QUOTE 도 교과 R9 와 같게 처리된다 ===');
var cq = SGB.suggest.build('‘토지’를 읽음',
  SGB.rulesCareer.scan('‘토지’를 읽음', SGB.rulesCareer.PROFILES.club))
  .filter(function (s) { return s.rule === 'QUOTE'; });
ok(cq.length === 2, '창체 굽은따옴표 2건 (실제: ' + cq.length + ')');
ok(cq.every(function (s) { return s.kind === 'safe' && s.to === "'"; }), '둘 다 safe, 곧은따옴표로');

console.log('=== 창체 MIDDOT 은 manual 유지 (문맥이 치환어를 정한다) ===');
var cm = SGB.suggest.build('자료·발표를 정리함',
  SGB.rulesCareer.scan('자료·발표를 정리함', SGB.rulesCareer.PROFILES.club))
  .filter(function (s) { return s.rule === 'MIDDOT'; });
ok(cm.length === 1 && cm[0].kind === 'manual' && cm[0].to === null, 'MIDDOT 은 제안 없음');

console.log('=== 과거형 — 검증된 패턴만 제안 ===');
[['자료를 정리했고 발표함', '정리했고', '정리하고'],
 ['보고서를 작성했음', '작성했음', '작성함'],
 ['실험을 설계하였다', '설계하였다', '설계함'],
 ['토론에 참여했으며 제시함', '참여했으며', '참여하며'],
 ['자신감을 얻었다', '얻었다', '얻음'],
 ['어려움이 있었으나 수행함', '있었으나', '있으나']
].forEach(function (row) {
  var s = sug(row[0]).filter(function (x) { return x.rule === 'R3과거시제' && x.from === row[1]; })[0];
  ok(s && s.kind === 'pattern' && s.to === row[2],
     row[1] + ' → ' + row[2] + ' (실제: ' + (s ? s.to : '없음') + ')');
});

console.log('=== 과거형 — 표에 없으면 제안하지 않는다 ===');
[['동아리를 이끌었던 경험', '이끌었던'],
 ['결과가 나왔을 때 분석함', '나왔을']
].forEach(function (row) {
  var s = sug(row[0]).filter(function (x) { return x.rule === 'R3과거시제' && x.from === row[1]; })[0];
  ok(s && s.kind === 'manual' && s.to === null, row[1] + ' → 제안 없음 (실제: ' + (s ? s.to : '없음') + ')');
});

console.log('=== 과거형 — 계사(이다) 활용형 ===');
[['반장이었다', '반장이었다', '반장임'],
 ['주도적이었다', '주도적이었다', '주도적임'],
 ['학생이었으나 성실함', '학생이었으나', '학생이나'],
 ['회장이었으며 성실함', '회장이었으며', '회장이며'],
 ['부장이었음', '부장이었음', '부장임']
].forEach(function (row) {
  var s = sug(row[0]).filter(function (x) { return x.rule === 'R3과거시제' && x.from === row[1]; })[0];
  ok(s && s.kind === 'pattern' && s.to === row[2],
     row[1] + ' → ' + row[2] + ' (실제: ' + (s ? s.to : '없음') + ')');
});

console.log('=== 과거형 — 어떤 제안도 이/하 를 남기지 않는다 ===');
['반장이었다', '모둠장이었다', '인상적이었다', '적극적이었음', '학생이었으나',
 '자료를 정리했고', '보고서를 작성했음', '실험을 설계하였다'].forEach(function (t) {
  sug(t).filter(function (x) { return x.rule === 'R3과거시제' && x.to; }).forEach(function (x) {
    ok(!/이음$|하음$|이으나$|하으나$/.test(x.to), t + ' → ' + x.to + ' 가 깨진 형태가 아님');
  });
});

console.log('=== apply — 켜진 제안만 적용, 인덱스 안 밀림 ===');
var t1 = '자료를 정리했고 구글 문서로 작성함';
var a1 = SGB.suggest.apply(t1, sug(t1));
ok(a1.indexOf('정리하고') !== -1, '과거형 적용됨 (' + a1 + ')');
ok(a1.indexOf('포털사이트') !== -1, '유의어 적용됨');
ok(a1.indexOf('정리했고') === -1 && a1.indexOf('구글') === -1, '원문 조각 안 남음');

console.log('=== apply — 끄면 원문 유지 ===');
var offs = sug(t1).map(function (s) { return Object.assign({}, s, { on: false }); });
ok(SGB.suggest.apply(t1, offs) === t1, '전부 끄면 원문 그대로');

console.log('=== apply — to 가 null 이면 건드리지 않는다 ===');
var t2 = '자료·발표를 정리함';
ok(SGB.suggest.apply(t2, sug(t2)) === t2, 'manual 만 있으면 원문 그대로');

console.log('=== apply — 겹치는 span 은 앞선 것만 ===');
var ov = [{ span: [0, 4], from: 'abcd', to: 'X', kind: 'safe', on: true, rule: 'T' },
          { span: [2, 6], from: 'cdef', to: 'Y', kind: 'safe', on: true, rule: 'T' }];
ok(SGB.suggest.apply('abcdefgh', ov) === 'Xefgh', '겹치면 앞선 것만 적용 (실제: ' + SGB.suggest.apply('abcdefgh', ov) + ')');

console.log('=== cuts — 문장 단위 삭제 후보 ===');
var t3 = '첫 문장이다. 두 번째 문장이다. 세 번째다.';
var cs = SGB.suggest.cuts(t3);
ok(cs.length === 3, '문장 3개 (실제: ' + cs.length + ')');
ok(cs.every(function (c) { return c.kind === 'cut' && c.on === false && c.to === ''; }), '전부 cut·기본해제·to 빈문자');
var c1 = Object.assign({}, cs[1], { on: true });
ok(SGB.suggest.apply(t3, [c1]).indexOf('두 번째') === -1, '켜면 그 문장이 사라진다');

console.log('=== ★ 속성 테스트 — 적용하면 그 finding 이 사라져야 한다 ===');
var CASES = [
  '자료를 정리했고 구글 문서로 작성함.',
  '‘토지’를 읽고 반론(counterargument)을 제시함.',
  '보고서를 작성했음. 실험을 설계하였다.',
  '앞줄\n뒷줄로 나뉨.'
];
CASES.forEach(function (text) {
  var before = RS.scan(text, { id: 'general', byteLimit: 1500 });
  var list = SGB.suggest.build(text, before);
  var fixed = SGB.suggest.apply(text, list);
  var after = RS.scan(fixed, { id: 'general', byteLimit: 1500 });

  // 켜서 적용한 규칙은 줄어야 한다
  var applied = {};
  list.forEach(function (s) { if (s.on && s.to !== null) applied[s.rule] = true; });
  Object.keys(applied).forEach(function (rule) {
    var b = before.filter(function (f) { return f.rule === rule; }).length;
    var a = after.filter(function (f) { return f.rule === rule; }).length;
    ok(a < b, rule + ' 감소 ' + b + '→' + a + '  [' + text.slice(0, 18) + '…]');
  });

  // 없던 규칙이 새로 생기면 안 된다
  var beforeRules = {};
  before.forEach(function (f) { beforeRules[f.rule] = true; });
  var born = after.filter(function (f) { return !beforeRules[f.rule]; })
                  .map(function (f) { return f.rule; });
  ok(born.length === 0, '새 이슈 없음 (생긴 것: ' + (born.join(',') || '없음') + ')');
});

console.log('\n' + (fail ? '★ 실패 ' + fail + '건' : '★ 전체 통과'));
process.exit(fail ? 1 : 0);
