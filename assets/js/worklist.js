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
    return { done: !!(e && e.done), edits: (e && e.edits) || {} };
  }
  function ensure(k) {
    if (!state[k]) state[k] = { done: false, edits: {} };
    return state[k];
  }
  function setDone(k, v) { ensure(k).done = !!v; persist(); }

  // 기본값에서 벗어난 것만 담는다. 기본 체크가 대부분이라 저장량이 작다.
  function setEdit(k, idx, v) { ensure(k).edits[String(idx)] = !!v; persist(); }

  function progress(keys) {
    var list = keys || [];
    var done = 0;
    list.forEach(function (k) { if (get(k).done) done++; });
    return { done: done, total: list.length };
  }
  function reset() { state = {}; persist(); }

  g.SGB.worklist = {
    key: key, get: get, setDone: setDone, setEdit: setEdit,
    progress: progress, reset: reset
  };
})();
