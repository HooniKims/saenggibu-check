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

console.log('\n' + (fail ? '★ 실패 ' + fail + '건' : '★ 전체 통과'));
process.exit(fail ? 1 : 0);
