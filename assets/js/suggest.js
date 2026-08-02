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
      out.push(mk(f, from, null, 'manual'));
    });
    return out;
  }

  g.SGB.suggest = { build: build };
})();
