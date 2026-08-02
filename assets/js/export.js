/*
 * SGB.exporter — 다운로드 3종 (§4)
 * 브라우저 전용 동작(파일 다운로드/클립보드)이 대부분이므로 DOM/XLSX/JSZip이 없으면 조용히 경고만 남기고 반환한다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};
  var hasDom = typeof document !== 'undefined';

  var DEFAULT_SUBJECT_COLUMNS = ['과목', '번호', '성명', '글자수', '바이트', '제한', '초과여부', '이슈수', '이슈상세'];
  var DEFAULT_PLAIN_COLUMNS = ['번호', '성명', '글자수', '바이트', '제한', '초과여부', '이슈수', '이슈상세'];

  function warn(msg) {
    if (typeof console !== 'undefined') console.warn('SGB.exporter: ' + msg);
  }

  function rowsToAoa(rows, columns) {
    var aoa = [columns];
    (rows || []).forEach(function (r) {
      aoa.push(columns.map(function (c) { return r && r[c] != null ? r[c] : ''; }));
    });
    return aoa;
  }

  function sanitizeSheetName(name) {
    return String(name || 'Sheet1').replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1';
  }

  // zip 엔트리 등 파일명 전용 sanitizer(시트명보다 넓은 OS 금지 문자 집합: \/:*?"<>|)
  function sanitizeFileName(name) {
    return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').trim() || 'file';
  }

  function downloadBlob(blob, fileName) {
    if (!hasDom) { warn('브라우저 환경이 아니어서 다운로드할 수 없습니다.'); return; }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // 1) 전체 요약 xlsx — 컬럼 선두에 과목
  function exportSummaryXlsx(rows, opts) {
    opts = opts || {};
    var XLSX = g.XLSX;
    if (!XLSX) { warn('XLSX가 로드되지 않았습니다.'); return; }
    var columns = opts.columns || DEFAULT_SUBJECT_COLUMNS;
    var ws = XLSX.utils.aoa_to_sheet(rowsToAoa(rows, columns));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '점검결과');
    var fileName = opts.fileName || '과목세특_점검결과_전체.xlsx';
    if (hasDom && typeof XLSX.writeFile === 'function') {
      XLSX.writeFile(wb, fileName);
    } else {
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); // Node 등 비-DOM 환경 대비
    }
  }

  // 2) 과목별 분리 xlsx (개별 버튼)
  function exportSubjectXlsx(subject, rows, opts) {
    opts = opts || {};
    var XLSX = g.XLSX;
    if (!XLSX) { warn('XLSX가 로드되지 않았습니다.'); return; }
    var columns = opts.columns || DEFAULT_PLAIN_COLUMNS;
    var ws = XLSX.utils.aoa_to_sheet(rowsToAoa(rows, columns));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(subject));
    var fileName = opts.fileName || (subject + '_점검결과.xlsx');
    if (hasDom && typeof XLSX.writeFile === 'function') {
      XLSX.writeFile(wb, fileName);
    } else {
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    }
  }

  // 과목별 모두 받기(zip) — groups: [{subject, rows}] 또는 {subject: rows}
  function exportAllSubjectsZip(groups, opts) {
    opts = opts || {};
    var XLSX = g.XLSX;
    var JSZip = g.JSZip;
    if (!XLSX) { warn('XLSX가 로드되지 않았습니다.'); return Promise.resolve(); }
    if (!JSZip) { warn('JSZip이 로드되지 않았습니다.'); return Promise.resolve(); }

    var entries = Array.isArray(groups)
      ? groups
      : Object.keys(groups || {}).map(function (k) { return { subject: k, rows: groups[k] }; });

    var columns = opts.columns || DEFAULT_PLAIN_COLUMNS;
    var zip = new JSZip();
    entries.forEach(function (grp) {
      var ws = XLSX.utils.aoa_to_sheet(rowsToAoa(grp.rows, columns));
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(grp.subject));
      var buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      zip.file(sanitizeFileName(grp.subject) + '_점검결과.xlsx', buf);
    });

    var fileName = opts.fileName || 'saenggibu_과목별점검_전체.zip';
    return zip.generateAsync({ type: hasDom ? 'blob' : 'nodebuffer' }).then(function (out) {
      if (hasDom) downloadBlob(out, fileName);
      return out;
    });
  }

  // 3) 이슈만 복사 — clipboard 실패 시 textarea 폴백
  function copyIssues(text) {
    if (!hasDom) { warn('브라우저 환경이 아니어서 복사할 수 없습니다.'); return Promise.resolve(false); }
    var body = text == null ? '' : String(text);

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = body;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    var announce = function () {
      if (g.SGB.core && typeof g.SGB.core.toast === 'function') g.SGB.core.toast('이슈 목록을 복사했습니다.');
    };

    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(body).then(function () {
        announce();
        return true;
      }).catch(function () {
        var ok = fallback();
        if (ok) announce();
        return ok;
      });
    }
    var ok = fallback();
    if (ok) announce();
    return Promise.resolve(ok);
  }

  g.SGB.exporter = {
    exportSummaryXlsx: exportSummaryXlsx,
    exportSubjectXlsx: exportSubjectXlsx,
    exportAllSubjectsZip: exportAllSubjectsZip,
    copyIssues: copyIssues
  };
})();
