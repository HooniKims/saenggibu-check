/*
 * SGB.writeback — 원본 워크북의 세특 셀만 교체해 NEIS 업로드용 xlsx 를 만든다.
 * DOM 을 모르는 순수 모듈. 브라우저/Node 이중 런타임.
 *
 * 원본 양식(헤더·행 수·다른 셀)을 그대로 두는 게 핵심이다. 그래야 NEIS 에
 * 되올릴 수 있다. 열 위치는 기존 SGB.parse._internal 을 재사용한다.
 *
 * 인쇄덤프는 NEIS 가 출력한 보고서라 되올릴 양식이 아니므로 거부한다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  function XL() {
    if (!g.XLSX) throw new Error('SGB.writeback: XLSX 가 로드되지 않았습니다.');
    return g.XLSX;
  }
  function cell(v) { return v == null ? '' : String(v).trim(); }

  // 창체 번들 양식(번호·성명·…·특기사항) 헤더 찾기.
  // career-app.js 의 findCareerBundleHeaderRow 와 같은 규칙이지만 그쪽이
  // 노출돼 있지 않아 여기서 다시 구현한다. 테스트로 결과를 대조한다.
  function findBundleHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 25); r++) {
      var cells = (rows[r] || []).map(function (c) {
        return (c == null ? '' : String(c)).replace(/\s+/g, '');
      });
      if (cells.indexOf('번호') !== -1 && cells.indexOf('성명') !== -1 &&
          cells.some(function (c) { return /특기.?사항/.test(c); })) return r;
    }
    return -1;
  }

  function planStandard(XLSX, rows, colInfo) {
    var out = [];
    var subject = '';
    for (var r = colInfo.headerRowIndex + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (colInfo.subjectIdx !== -1 && cell(row[colInfo.subjectIdx])) {
        subject = cell(row[colInfo.subjectIdx]);
      }
      var name = cell(row[colInfo.nameIdx]);
      var text = cell(row[colInfo.textIdx]);
      if (!name || !text) continue;
      out.push({
        addr: XLSX.utils.encode_cell({ r: r, c: colInfo.textIdx }),
        no: colInfo.noIdx != null ? cell(row[colInfo.noIdx]) : '',
        name: name, subject: subject, text: text
      });
    }
    return out;
  }

  var BUNDLE_NAME_COL = 1;
  var BUNDLE_TEXT_COL = 3; // career-app.js 와 동일하게 4번째 열 고정

  function planBundle(XLSX, rows, headerRow) {
    var out = [];
    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var name = cell(row[BUNDLE_NAME_COL]);
      var text = cell(row[BUNDLE_TEXT_COL]);
      if (!name || !text || text === '희망분야') continue;
      out.push({
        addr: XLSX.utils.encode_cell({ r: r, c: BUNDLE_TEXT_COL }),
        no: cell(row[0]), name: name, subject: '', text: text
      });
    }
    return out;
  }

  var MULTIROW_REASON = '여러 줄에 나뉘어 기록된 양식입니다. 한 학생의 글이 여러 행에 걸쳐 있어 ' +
    '수정본 파일을 만들 수 없습니다. 고친 문장 복사를 이용하세요.';

  // career-app.js:parseCareerBundleRows 는 성명이 빈 연속 행의 특기사항을
  // 앞 학생 글에 이어붙여 하나의 문자열로 합친다(N행 → 1개 텍스트).
  // 그 병합된 결과를 한 셀에 되쓰고 나머지 행을 비우면 원본 행 구조가
  // 바뀌어 버려 되올릴 수 없다. 그래서 이런 다중행 기록은 절반만
  // 처리하지 않고 통째로 거부한다 — 인쇄덤프와 같은 방식.
  //
  // findColumnIndices 가 표준 그리드로 오인하는 창체 번들도 있어(성명·
  // 특기사항 헤더만 보고 표준으로 판단), nameCol/textCol 을 넘겨받아
  // 표준 경로·번들 경로 양쪽에서 같은 검사를 쓴다.
  function hasContinuationRows(rows, headerRow, nameCol, textCol) {
    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var name = cell(row[nameCol]);
      var text = cell(row[textCol]);
      if (!name && text) return true;
    }
    return false;
  }

  function plan(workbook) {
    var XLSX = XL();
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
      return { ok: false, reason: '읽을 시트가 없습니다.', format: 'unknown', cells: [] };
    }
    var ws = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    var I = g.SGB.parse && g.SGB.parse._internal;
    if (!I) throw new Error('SGB.writeback: xlsx-parse.js 를 먼저 로드하세요.');

    if (I.detectFormat(rows) === 'printdump') {
      return {
        ok: false,
        reason: 'NEIS 인쇄 출력 형식입니다. 되올릴 수 있는 양식이 아니라 수정본 파일을 만들 수 없습니다. 고친 문장 복사를 이용하세요.',
        format: 'printdump', cells: []
      };
    }

    var columnFound = false;

    var colInfo = I.findColumnIndices(rows);
    if (colInfo) {
      columnFound = true;
      if (hasContinuationRows(rows, colInfo.headerRowIndex, colInfo.nameIdx, colInfo.textIdx)) {
        return { ok: false, reason: MULTIROW_REASON, format: 'standard', cells: [] };
      }
      var cells = planStandard(XLSX, rows, colInfo);
      if (cells.length) return { ok: true, format: 'standard', cells: cells };
    }

    var hr = findBundleHeader(rows);
    if (hr !== -1) {
      columnFound = true;
      if (hasContinuationRows(rows, hr, BUNDLE_NAME_COL, BUNDLE_TEXT_COL)) {
        return { ok: false, reason: MULTIROW_REASON, format: 'bundle', cells: [] };
      }
      var bc = planBundle(XLSX, rows, hr);
      if (bc.length) return { ok: true, format: 'bundle', cells: bc };
    }

    if (columnFound) {
      return { ok: false, reason: '세특 내용이 비어 있어 수정할 것이 없습니다.', format: 'unknown', cells: [] };
    }
    return { ok: false, reason: '세특 열을 찾지 못했습니다.', format: 'unknown', cells: [] };
  }

  // replacements: { 'G2': '새 텍스트', ... }
  // 원본 workbook 을 건드리지 않도록 깊은 복사 후 교체한다.
  // 시트에 없는 주소는 조용히 버리지 않고 던진다 — NEIS 재업로드 파일에서
  // 교체 하나가 소리 없이 사라지면 교사가 알아챌 방법이 없다.
  function build(workbook, replacements) {
    var XLSX = XL();
    var copy = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    var ws = copy.Sheets[copy.SheetNames[0]];

    var missing = [];
    Object.keys(replacements || {}).forEach(function (addr) {
      if (!ws[addr]) missing.push(addr);
    });
    if (missing.length) {
      throw new Error('SGB.writeback.build: 시트에 없는 셀 주소입니다 — ' + missing.join(', '));
    }

    Object.keys(replacements || {}).forEach(function (addr) {
      ws[addr].t = 's';
      ws[addr].v = replacements[addr];
      delete ws[addr].w; // 캐시된 표시 문자열 제거
      delete ws[addr].r;
    });
    return XLSX.write(copy, { type: 'array', bookType: 'xlsx' });
  }

  g.SGB.writeback = { plan: plan, build: build };
})();
