/*
 * SGB.core — 상태·렌더·하이라이트·localStorage 공용 유틸
 * 이중 런타임: 브라우저 / Node(테스트). DOM 이 없는 환경에서는 DOM 조작 함수가 조용히 no-op 한다.
 * 렌더 책임 경계: 여기서는 §2 계약 클래스명(mark.m-*, .gauge/.gauge-fill, .toast)만 사용하고
 * 페이지 DOM 구성(.subject-section 등)은 알지 못한다 — 그건 각 app.js(T3/T4) 소관.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};
  var hasDom = typeof document !== 'undefined';

  // ------------------------------------------------------------------
  // 바이트/글자 계산
  // ------------------------------------------------------------------
  // mode: 'utf3'(교과 — ord>127 문자를 3바이트로, 실제 UTF-8 한글 인코딩과 동일)
  //     | 'neis2'(창체 — NEIS 레거시 관행상 한글 등 non-ASCII 문자를 2바이트로 계산)
  function byteLen(text, mode) {
    var s = text == null ? '' : String(text);
    var bytes = 0;
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xFFFF) i++; // 서로게이트 쌍 보정
      bytes += cp > 0x7F ? (mode === 'neis2' ? 2 : 3) : 1;
    }
    return bytes;
  }

  function charLen(text) {
    return Array.from(text == null ? '' : String(text)).length;
  }

  // ------------------------------------------------------------------
  // HTML 이스케이프 + 하이라이트 렌더
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(str) { return escapeHtml(str); }

  // findings: [{rule, grade:'violation'|'check'|'info', span:[s,e], quote, note, color:'m-red'|'m-brown'|...}]
  function buildAnnotatedHtml(text, findings) {
    var s = text == null ? '' : String(text);
    if (!findings || !findings.length) return escapeHtml(s);

    var sorted = findings.slice().sort(function (a, b) { return a.span[0] - b.span[0]; });
    var kept = [];
    var lastEnd = -1;
    sorted.forEach(function (f) {
      var start = f.span[0], end = f.span[1];
      if (start >= lastEnd) { kept.push(f); lastEnd = end; }
    });

    var html = '';
    var cursor = 0;
    kept.forEach(function (f) {
      var start = f.span[0], end = f.span[1];
      html += escapeHtml(s.slice(cursor, start));
      var cls = f.color || 'm-slate';
      var title = f.note || f.quote || f.rule || '';
      html += '<mark class="' + escapeAttr(cls) + '" title="' + escapeAttr(title) + '" aria-label="' + escapeAttr(title) + '">' + escapeHtml(s.slice(start, end)) + '</mark>';
      cursor = end;
    });
    html += escapeHtml(s.slice(cursor));
    return html;
  }

  // ------------------------------------------------------------------
  // 게이지 렌더 — el 은 .gauge 컨테이너, 내부에 .gauge-fill 을 채운다.
  // ------------------------------------------------------------------
  function renderGauge(el, chars, bytes, limit) {
    if (!hasDom || !el) return;
    var fill = el.querySelector('.gauge-fill');
    if (!fill) {
      fill = document.createElement('div');
      fill.className = 'gauge-fill';
      el.appendChild(fill);
    }
    var pct = limit > 0 ? Math.min(100, (bytes / limit) * 100) : 0;
    // width가 아닌 transform:scaleX로 채운다 — 레이아웃 재계산 없이 합성만으로 전환(시각 결과는 동일).
    // 대응 base 스타일(width:100%/transform-origin:left)은 checker.css .gauge-fill 에서 설정.
    fill.style.transform = 'scaleX(' + (pct / 100) + ')';
    var over = bytes > limit;
    el.classList.toggle('over', over);
    fill.classList.toggle('over', over);
    el.setAttribute('aria-label', chars + '자 · ' + bytes + ' / ' + limit + 'B');
    el.dataset.chars = chars;
    el.dataset.bytes = bytes;
    el.dataset.limit = limit;
  }

  // ------------------------------------------------------------------
  // localStorage 래퍼
  // ------------------------------------------------------------------
  function saveState(key, state) {
    try {
      var storage = (hasDom || typeof localStorage !== 'undefined') ? localStorage : null;
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(state));
      return true;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('SGB.core.saveState 실패', e);
      return false;
    }
  }

  function loadState(key) {
    try {
      var storage = (hasDom || typeof localStorage !== 'undefined') ? localStorage : null;
      if (!storage) return null;
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('SGB.core.loadState 실패', e);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // 토스트
  // ------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    if (!hasDom) return;
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  // ------------------------------------------------------------------
  // 이슈 그룹핑 — 결과 밀도 축소(§P1). 순서를 보존하며 keyFn 반환값이 같은
  // 항목끼리 묶는다. 페이지별 표시 로직(subject/career)은 각 app.js가 담당.
  // ------------------------------------------------------------------
  function groupBy(items, keyFn) {
    var order = [];
    var map = {};
    (items || []).forEach(function (it) {
      var k = keyFn(it);
      if (!Object.prototype.hasOwnProperty.call(map, k)) { map[k] = []; order.push(k); }
      map[k].push(it);
    });
    return order.map(function (k) { return { key: k, items: map[k] }; });
  }

  g.SGB.core = {
    byteLen: byteLen,
    charLen: charLen,
    escapeHtml: escapeHtml,
    buildAnnotatedHtml: buildAnnotatedHtml,
    renderGauge: renderGauge,
    saveState: saveState,
    loadState: loadState,
    toast: toast,
    groupBy: groupBy
  };
})();
