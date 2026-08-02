/*
 * SGB.suggest — finding 을 "고칠 수 있는 제안"으로 바꾼다.
 * DOM 을 모르는 순수 모듈. 브라우저/Node 이중 런타임.
 *
 * 원칙
 *   1. from 은 항상 text.slice(span[0], span[1]) 이다.
 *      finding.quote 는 규칙마다 의미가 달라(R2·R9 는 문맥 전체) 쓰면 안 된다.
 *   2. 문맥이 필요한 치환은 제안하지 않는다(kind:'manual'). 위치만 짚는다.
 *   3. 자동 적용은 없다. on 은 기본 체크 여부일 뿐이고 확정은 사람이 한다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  // 유의어 note 형식: 기재 유의어 — 대체 표현: 「동영상 플랫폼·영상 창작자」
  // rules-*.js 가 CAUTION_TERMS 를 노출하지 않아 note 에서 뽑는다.
  // 57쌍을 복사해두면 상수 복제가 하나 더 생기므로 이 방식을 쓴다.
  var ALT_RE = /「(.+?)」/;

  // 굽은 따옴표·겹화살괄호는 전부 곧은 작은따옴표로 간다.
  var QUOTE_MAP = {
    '‘': "'", '’': "'", '“': "'", '”': "'",
    '『': "'", '』': "'", '「': "'", '」': "'",
    '《': "'", '》': "'", '〈': "'", '〉': "'"
  };

  // 과거형 어미 패턴표 — 검증된 것만 넣는다.
  // '했 → 하' 단순 치환은 '작성했음 → 작성하음' 처럼 말을 부순다.
  // 어미 단위로 긴 것부터 대조해야 '했음' 이 '했' 보다 먼저 걸린다.
  var PAST_ENDINGS = [
    ['하였으며', '하며'], ['하였다', '함'], ['하였고', '하고'], ['하였음', '함'],
    ['했으며', '하며'], ['했고', '하고'], ['했음', '함'], ['했다', '함'],
    ['었으나', '으나'], ['았으나', '으나'],
    ['었다', '음'], ['았다', '음'], ['였음', '임'],
    // 계사(이다) 활용형 — '었다/었으나' 만으로는 앞의 '이' 가 남아
    // '반장이었다 → 반장이음' 처럼 말을 부순다. '이' 까지 포함해 통째로 대조한다.
    ['이었으며', '이며'], ['이었으나', '이나'], ['이었다', '임'],
    ['이었고', '이고'], ['이었음', '임']
  ];

  // 긴 어미부터 대조해야 '이었다' 가 '었다' 보다 먼저 걸린다.
  // 배열 순서에 의존하면 나중에 항목을 덧붙일 때 조용히 깨진다.
  var PAST_SORTED = PAST_ENDINGS.slice().sort(function (a, b) {
    return b[0].length - a[0].length;
  });

  function mk(f, from, to, kind, alts) {
    return {
      span: [f.span[0], f.span[1]],
      from: from,
      to: to,
      rule: f.rule,
      kind: kind,
      alts: alts || null,
      on: kind === 'safe' || kind === 'pattern'
    };
  }

  // 유의어 — alt 에 가운뎃점이 있으면 후보가 여러 개일 수 있는데,
  // '영상 제작·편집 프로그램' 처럼 한 낱말 안의 가운뎃점과 구분할 수 없다.
  // 그래서 자동 제안하지 않고 후보를 쪼개 교사에게 고르게 한다.
  function fromCaution(f, from) {
    var m = ALT_RE.exec(f.note || '');
    if (!m) return mk(f, from, null, 'manual');
    var alt = m[1];
    if (alt.indexOf('·') === -1) return mk(f, from, alt, 'safe');
    return mk(f, from, null, 'choice', alt.split('·'));
  }

  function fromR9(f, from) {
    if (/^[\r\n]+$/.test(from)) return mk(f, from, ' ', 'safe');
    if (from.length === 1 && QUOTE_MAP[from]) return mk(f, from, QUOTE_MAP[from], 'safe');
    return mk(f, from, null, 'manual'); // 따옴표 짝 불일치 등
  }

  // 반론(counterargument) → 반론
  function fromParen(f, from) {
    var cut = from.replace(/\s*\([A-Za-z][A-Za-z0-9\- ]*\)\s*$/, '');
    if (cut && cut !== from) return mk(f, from, cut, 'safe');
    return mk(f, from, null, 'manual');
  }

  // 어절 끝이 패턴표에 있으면 치환하고, 없으면 제안하지 않는다.
  // 관형형('이끌었던'·'나왔을')과 인용 내부('느꼈다고')는 표에 없으므로
  // 자동으로 manual 로 떨어진다.
  function fromPast(f, from) {
    for (var i = 0; i < PAST_SORTED.length; i++) {
      var end = PAST_SORTED[i][0];
      if (from.length > end.length && from.slice(-end.length) === end) {
        return mk(f, from, from.slice(0, -end.length) + PAST_SORTED[i][1], 'pattern');
      }
    }
    return mk(f, from, null, 'manual');
  }

  function build(text, findings) {
    var s = text == null ? '' : String(text);
    var out = [];
    (findings || []).forEach(function (f) {
      if (!f || !f.span) return;
      var a = f.span[0], b = f.span[1];
      if (b <= a) return; // R10분량 등 0폭 finding 은 제안 대상이 아니다
      var from = s.slice(a, b);
      if (f.rule === 'N1기재유의어' || f.rule === 'CAUTION') { out.push(fromCaution(f, from)); return; }
      if (f.rule === 'R9줄바꿈도서명' || f.rule === 'QUOTE') { out.push(fromR9(f, from)); return; }
      if (f.rule === 'N2괄호영문' || f.rule === 'PARENROMAN') { out.push(fromParen(f, from)); return; }
      if (f.rule === 'R3과거시제') { out.push(fromPast(f, from)); return; }
      out.push(mk(f, from, null, 'manual'));
    });
    return out;
  }

  // 문장 경계 찾기. 숫자 사이의 마침표(92.5, 3.14)는 종결부호가 아니다 —
  // 그대로 쪼개면 '실험 결과 92.' / '5점을 얻음.' 같은 조각이 생기고,
  // 교사가 그걸 삭제하면 '실험 결과 92.만족스러움.' 이 된다.
  // from 은 원칙 1(span 슬라이스)을 그대로 따른다 — trim 하지 않는다.
  function pushCut(out, s, a, b) {
    if (!s.slice(a, b).trim()) return;
    out.push({
      span: [a, b], from: s.slice(a, b), to: '',
      rule: 'CUT', kind: 'cut', alts: null, on: false
    });
  }

  // 문장 단위 삭제 후보. 바이트를 줄일 때 쓴다.
  // 수정 제안과 같은 배열에 담아 적용 경로를 하나로 유지한다.
  function cuts(text) {
    var s = text == null ? '' : String(text);
    var out = [];
    var start = 0;
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '.' || ch === '!' || ch === '?') {
        if (ch === '.' && i > 0 && i + 1 < s.length &&
            /[0-9]/.test(s.charAt(i - 1)) && /[0-9]/.test(s.charAt(i + 1))) {
          i++;            // 소수점 — 종결이 아니다
          continue;
        }
        while (i < s.length && '.!?'.indexOf(s.charAt(i)) !== -1) i++;   // ... 같은 연속 부호
        while (i < s.length && /\s/.test(s.charAt(i))) i++;              // 뒤따르는 공백까지 포함
        pushCut(out, s, start, i);
        start = i;
        continue;
      }
      i++;
    }
    if (start < s.length) pushCut(out, s, start, s.length);
    return out;
  }

  // 뒤에서 앞으로 치환해 인덱스가 밀리지 않게 한다.
  // 겹치는 span 은 앞선 것만 채택한다 — buildAnnotatedHtml 과 같은 규칙.
  function apply(text, suggestions) {
    var s = text == null ? '' : String(text);
    var live = (suggestions || []).filter(function (x) {
      return x && x.on && x.to !== null && x.to !== undefined;
    });
    live.sort(function (a, b) { return a.span[0] - b.span[0]; });

    var kept = [];
    var lastEnd = -1;
    live.forEach(function (x) {
      if (x.span[0] >= lastEnd) { kept.push(x); lastEnd = x.span[1]; }
    });

    for (var i = kept.length - 1; i >= 0; i--) {
      s = s.slice(0, kept[i].span[0]) + kept[i].to + s.slice(kept[i].span[1]);
    }
    return s;
  }

  g.SGB.suggest = { build: build, cuts: cuts, apply: apply };
})();
