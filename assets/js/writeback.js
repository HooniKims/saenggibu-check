/*
 * SGB.writeback — 원본 워크북의 세특 셀만 교체해 NEIS 업로드용 xlsx 를 만든다.
 * DOM 을 모르는 순수 모듈. 브라우저/Node 이중 런타임.
 *
 * 원본 양식(헤더·행 수·다른 셀)을 그대로 두는 게 핵심이다. 그래야 NEIS 에
 * 되올릴 수 있다. 열 위치는 기존 SGB.parse._internal 을 재사용한다.
 *
 * 인쇄덤프는 NEIS 가 출력한 보고서라 되올릴 양식이 아니므로 거부한다.
 *
 * ---
 * 행 걷기는 xlsx-parse.js:parseNeisRows(338·350·359줄의 getStudentNo·
 * isStdHeaderRow·isLikelyName 포함) 와 완전히 같은 분기·같은 순서로 한다.
 * 리더가 여러 행을 합쳐 보여주는 텍스트와 워크백이 쓰는 셀 주소가 어긋나면
 * 그 자체로 기록이 훼손된다 — 연속행을 못 보고 첫 셀에만 쓰면 재파싱 때
 * 리더가 남은 연속행을 또 합쳐 꼬리가 중복된다. 그래서 여기서 별도의
 * "다중행/꼬리말" 판별 규칙을 만들지 않는다. 리더와 같은 규칙으로 걸어
 * 같은 텍스트를 보고, 그 텍스트가 여러 셀(addr + extra[])에서 왔다는 것만
 * 기록해 둔다 — build() 가 extra 셀들을 비워야 재파싱 때 중복이 안 생긴다.
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
  // 헤더 키워드 매칭 전용 — xlsx-parse.js:normStripAll 과 동일(공백 전부 제거)
  function normStripAll(v) { return (v == null ? '' : String(v)).replace(/\s+/g, '').replace(/﻿/g, ''); }

  // xlsx-parse.js:338 getStudentNo 와 동일
  function getNo(row, colInfo) {
    var noMode = colInfo.noMode, noIdx = colInfo.noIdx, banIdx = colInfo.banIdx, beonIdx = colInfo.beonIdx;
    if (noMode === 'none') return '';
    if (noMode === 'ban_beon') {
      var ban = cell(row[banIdx]);
      var beon = cell(row[beonIdx]);
      if (ban && beon) return ban + '-' + beon;
      return ban || beon;
    }
    return cell(row[noIdx]);
  }

  // xlsx-parse.js:350 isStdHeaderRow 와 동일
  function isHeaderRow(rawNo, rawName, colInfo) {
    var nNo = normStripAll(rawNo);
    var nName = normStripAll(rawName);
    if (nNo === '반/번호' || nName === '성명') return true;
    if (colInfo.noMode === 'ban_beon' && (nNo === '반' || nNo === '번호')) return true;
    if (nName === '이름' || nName === '학생명') return true;
    return false;
  }

  // xlsx-parse.js:359 isLikelyName 과 동일
  function isLikelyName(s) {
    return /^[가-힣]{2,5}$/.test(s) && ['성명', '이름', '학생명', '학년', '학기', '반', '번호', '과목', '교과'].indexOf(s) === -1;
  }

  // xlsx-parse.js:374-394 parseNeisRows 와 같은 순서·같은 분기로 걷는다.
  // 다른 점은 텍스트뿐 아니라 그 텍스트가 나온 셀 주소도 같이 쌓는다는
  // 것이다 — 첫 셀 addr 와, 거기 합쳐진 연속행 extra[]. build() 가 이걸
  // 알아야 정확히 그 셀들만 쓰고 나머지 연속행을 비울 수 있다.
  function planStandard(XLSX, rows, colInfo) {
    var out = [];
    var subject = '';
    var current = null;
    var start = colInfo.guessed ? colInfo.headerRowIndex : colInfo.headerRowIndex + 1;

    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var no = getNo(row, colInfo);
      var name = cell(row[colInfo.nameIdx]);
      var text = cell(row[colInfo.textIdx]);
      if (colInfo.subjectIdx !== -1 && cell(row[colInfo.subjectIdx])) {
        subject = cell(row[colInfo.subjectIdx]);
      }
      if (isHeaderRow(no, name, colInfo)) continue;
      if (!no && !name && !text) continue;

      if (isLikelyName(name) || (name && text)) {
        current = {
          addr: XLSX.utils.encode_cell({ r: r, c: colInfo.textIdx }),
          no: no, name: name, subject: subject, text: text,
          extra: [] // 이 학생 텍스트에 합쳐진 추가 셀 주소들
        };
        out.push(current);
      } else if (!no && !name && text && current) {
        current.text += (current.text ? ' ' : '') + text;
        current.extra.push(XLSX.utils.encode_cell({ r: r, c: colInfo.textIdx }));
      }
    }
    return out.filter(function (c) { return c.name; });
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

    // parseStandard/parseNeisRows 와 동일한 열 탐지 순서(정규 헤더 → 추정).
    var colInfo = I.findColumnIndices(rows) || I.guessColumnIndices(rows);
    if (colInfo) {
      var cells = planStandard(XLSX, rows, colInfo);
      if (cells.length) return { ok: true, format: 'standard', cells: cells };
      return { ok: false, reason: '세특 내용이 비어 있어 수정할 것이 없습니다.', format: 'unknown', cells: [] };
    }

    return { ok: false, reason: '세특 열을 찾지 못했습니다.', format: 'unknown', cells: [] };
  }

  // replacements: { 'G2': '새 텍스트', ... }  (plan().cells 의 addr 기준)
  // planResult 를 함께 받으면(선택) 각 교체 셀의 extra(연속행) 를 비운다.
  // 비우지 않으면 리더가 그 연속행을 다시 합쳐 읽어 꼬리가 중복된다.
  // 원본 workbook 을 건드리지 않도록 깊은 복사 후 교체한다.
  // 시트에 없는 주소는 조용히 버리지 않고 던진다 — NEIS 재업로드 파일에서
  // 교체 하나가 소리 없이 사라지면 교사가 알아챌 방법이 없다.
  function build(workbook, replacements, planResult) {
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

    var extraByAddr = {};
    if (planResult && planResult.cells) {
      planResult.cells.forEach(function (c) {
        if (c.extra && c.extra.length) extraByAddr[c.addr] = c.extra;
      });
    }

    Object.keys(replacements || {}).forEach(function (addr) {
      ws[addr].t = 's';
      ws[addr].v = replacements[addr];
      delete ws[addr].w; // 캐시된 표시 문자열 제거
      delete ws[addr].r;

      var extras = extraByAddr[addr];
      if (extras) {
        extras.forEach(function (eaddr) {
          if (!ws[eaddr]) ws[eaddr] = { t: 's' };
          ws[eaddr].t = 's';
          ws[eaddr].v = '';
          delete ws[eaddr].w;
          delete ws[eaddr].r;
        });
      }
    });

    return XLSX.write(copy, { type: 'array', bookType: 'xlsx' });
  }

  g.SGB.writeback = { plan: plan, build: build };
})();
