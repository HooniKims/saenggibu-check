/*
 * SGB.worklist — 집중 모드 진행 상태.
 * DOM 을 모르는 순수 모듈. 브라우저/Node 이중 런타임.
 *
 * 키는 번호|성명|과목 — SGB.parse.mergeStudents 의 병합 키와 같은 규칙이라
 * 파일을 다시 올려도 진행 상태가 그대로 붙는다.
 *
 * 기존 sgb_subject_v1 / sgb_career_v1 스키마는 건드리지 않고 별도 키를 쓴다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  var STORAGE_KEY = 'sgb_worklist_v1';
  var state = (g.SGB.core && g.SGB.core.loadState(STORAGE_KEY)) || {};

  function persist() {
    if (g.SGB.core) g.SGB.core.saveState(STORAGE_KEY, state);
  }
  function norm(v) { return (v == null ? '' : String(v)).replace(/\s+/g, ''); }

  function key(no, name, subject) {
    return norm(no) + '|' + norm(name) + '|' + norm(subject);
  }
  function get(k) {
    var e = state[k];
    return {
      done: !!(e && e.done), edits: (e && e.edits) || {}, picks: (e && e.picks) || {},
      meta: (e && e.meta) || {}
    };
  }
  function ensure(k) {
    if (!state[k]) state[k] = { done: false, edits: {}, picks: {} };
    if (!state[k].picks) state[k].picks = {};
    if (!state[k].meta) state[k].meta = {};
    return state[k];
  }
  function setDone(k, v) { ensure(k).done = !!v; persist(); }

  // meta = { rule, span:[a,b], from } — 저장 시점의 제안 신원이다. 복원할 때
  // 이 신원이 지금 그 인덱스의 제안과 같은지 호출 쪽(work-app.js)이 대조해야
  // 한다. 수정본을 내려받아 재업로드하면 텍스트·finding·인덱스가 전부 바뀌므로,
  // 인덱스만 믿고 값을 되살리면 엉뚱한 제안(다른 span, 다른 rule)에 값이 묻어
  // 들어간다 — CUT 자리에 choice 값이 앉는 식으로. meta 는 그 사고를 막는
  // 근거를 남기는 용도일 뿐이고, 실제 일치 판정은 여기서 하지 않는다(이 모듈은
  // DOM/제안 목록을 몰라 판정할 수 없다).
  //
  // 기본값에서 벗어난 것만 담는다. 기본 체크가 대부분이라 저장량이 작다.
  function setEdit(k, idx, v, meta) {
    var e = ensure(k);
    e.edits[String(idx)] = !!v;
    if (meta) e.meta[String(idx)] = meta;
    persist();
  }

  // 선택지(choice) 는 고른 대체어 문자열을 그대로 보존해야 한다.
  // setEdit 은 체크 여부라 !!v 로 강제하므로 값을 담을 수 없다.
  function setPick(k, idx, alt, meta) {
    var e = ensure(k);
    e.picks[String(idx)] = alt;
    if (meta) e.meta[String(idx)] = meta;
    persist();
  }

  function progress(keys) {
    var list = keys || [];
    var done = 0;
    list.forEach(function (k) { if (get(k).done) done++; });
    return { done: done, total: list.length };
  }
  function reset() { state = {}; persist(); }

  g.SGB.worklist = {
    key: key, get: get, setDone: setDone, setEdit: setEdit, setPick: setPick,
    progress: progress, reset: reset
  };
})();
