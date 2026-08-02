/*
 * SGB.parse — 공용 NEIS xlsx 파서
 * 이중 런타임: 브라우저(<script> 순서 로드) / Node(createRequire, 테스트용)
 * 의존: assets/vendor/xlsx.full.min.js 가 먼저 로드되어 g.XLSX 를 채워야 한다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  // ------------------------------------------------------------------
  // 공통 문자열 유틸
  // ------------------------------------------------------------------

  // §0b: trim + 연속 공백 1칸 축약 (헤더/노이즈/학급행 매칭 전용 — 실제 텍스트 내용은 훼손 금지)
  function normCollapse(v) {
    return (v == null ? '' : String(v)).trim().replace(/\s+/g, ' ');
  }
  // 헤더 키워드 매칭용: 공백을 전부 제거해 '과 목'↔'과목', '성  명'↔'성명' 등을 동일 취급
  function normStripAll(v) {
    return (v == null ? '' : String(v)).replace(/\s+/g, '').replace(/﻿/g, '');
  }
  // 셀 원문(trim만, 내부 공백 보존) — 학생 세특 본문 등 내용 보존이 필요한 값
  function rawCell(v) {
    return (v == null ? '' : String(v)).trim();
  }

  // ------------------------------------------------------------------
  // §3.0 범위 재계산 — !ref(dimension)를 신뢰하지 않고 실제 셀 키를 스캔
  // ------------------------------------------------------------------
  function recomputeRef(XLSX, ws) {
    var minRow = Infinity, minCol = Infinity, maxRow = -Infinity, maxCol = -Infinity;
    var found = false;
    for (var key in ws) {
      if (!Object.prototype.hasOwnProperty.call(ws, key)) continue;
      if (key.charAt(0) === '!') continue;
      var addr = XLSX.utils.decode_cell(key);
      found = true;
      if (addr.r < minRow) minRow = addr.r;
      if (addr.c < minCol) minCol = addr.c;
      if (addr.r > maxRow) maxRow = addr.r;
      if (addr.c > maxCol) maxCol = addr.c;
    }
    if (!found) return ws;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } });
    return ws;
  }

  function sheetToRows(XLSX, ws) {
    recomputeRef(XLSX, ws);
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  // ====================================================================
  // §3.1 포맷 감지
  // ====================================================================
  // NEIS 업로드 표준 양식(그리드) 헤더에만 등장하는 열 이름들 — 인쇄덤프 헤더에는 없다.
  // 표준 양식도 '과목'+'성명'을 함께 가지므로(학년도/…/과목/과목코드/반/번호/성명/…),
  // 이 마커가 하나라도 있으면 인쇄덤프 헤더가 아니라 표준 그리드 헤더다.
  var STD_GRID_ONLY_MARKERS = ['반/번호', '학년도', '학생개인번호', '과목코드'];

  function isPrintDumpHeaderRow(row) {
    var stripped = (row || []).map(normStripAll);
    if (stripped.indexOf('과목') === -1 || stripped.indexOf('성명') === -1) return false;
    for (var i = 0; i < STD_GRID_ONLY_MARKERS.length; i++) {
      if (stripped.indexOf(STD_GRID_ONLY_MARKERS[i]) !== -1) return false;
    }
    return true;
  }

  function detectFormat(rows) {
    var scanLimit = Math.min(rows.length, 60);
    for (var r = 0; r < scanLimit; r++) {
      if (isPrintDumpHeaderRow(rows[r] || [])) return 'printdump';
    }
    return 'standard';
  }

  // ====================================================================
  // §3.2 인쇄덤프 모드 (1-6/1-5 과세특형)
  // ====================================================================
  var CLASS_ROW_RE = /\d학년\s*\d+반/;
  var DATE_ROW_RE = /^\d{4}\.\d{2}\.\d{2}\.$/;
  var PAGE_FOOTER_RE = /^\d+\s*\/\s*\d+$/;

  function findHeaderColInfo(row) {
    var stripped = (row || []).map(normStripAll);
    var subjectIdx = stripped.indexOf('과목');
    var nameIdx = stripped.indexOf('성명');
    if (subjectIdx === -1 || nameIdx === -1) return null;
    var textIdx = -1;
    for (var i = 0; i < stripped.length; i++) {
      if (stripped[i].indexOf('세부능력') !== -1 && stripped[i].indexOf('특기사항') !== -1) { textIdx = i; break; }
    }
    if (textIdx === -1) {
      for (var j = 0; j < stripped.length; j++) {
        if (stripped[j].indexOf('특기사항') !== -1) { textIdx = j; break; }
      }
    }
    if (textIdx === -1) textIdx = nameIdx + 2; // 관찰된 레이아웃(성명, 공백, 세특) 기반 보수적 대체
    var noIdx = stripped.indexOf('번호');
    if (noIdx === -1) {
      noIdx = -1;
      for (var k = 0; k < stripped.length; k++) {
        if (stripped[k].indexOf('번호') !== -1 || stripped[k].indexOf('연번') !== -1 || stripped[k].indexOf('학번') !== -1) { noIdx = k; break; }
      }
    }
    return { subjectIdx: subjectIdx, nameIdx: nameIdx, textIdx: textIdx, noIdx: noIdx };
  }

  function normNo(v) {
    return normStripAll(v);
  }

  function parsePrintDump(rows) {
    var colInfo = null;
    var sourceLabel = '';
    var studentsMap = new Map();
    var order = [];
    var lastEntry = null;
    var lastEntryOwnerKey = null;
    var currentSubject = '';
    var rawSubjectSeq = [];
    var seq = 0;
    var namedRowCount = 0; // 성명이 있는 원본 데이터 행 수(연속행 제외) — 골든 오라클과 동일 정의

    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i] || [];
      var cells = raw.map(normCollapse);
      if (!cells.some(Boolean)) continue; // 완전 빈 행

      // 헤더행(과목+성명 동시 등장) — 페이지마다 재등장, 열 인덱스 재확정
      var headerInfo = findHeaderColInfo(raw);
      if (headerInfo) {
        colInfo = headerInfo;
        continue;
      }

      // 학급행 — 비앵커 검색, 행 전체 문자열을 sourceLabel로 보존
      var classCell = null;
      for (var ci = 0; ci < cells.length; ci++) {
        if (CLASS_ROW_RE.test(cells[ci])) { classCell = cells[ci]; break; }
      }
      if (classCell) {
        sourceLabel = classCell;
        continue;
      }

      // 기타 노이즈 행: 사용자명, 날짜, 학교생활기록부 제목행, 페이지 푸터
      if (cells.some(function (c) { return c.indexOf('사용자명') !== -1; })) continue;
      if (cells.some(function (c) { return DATE_ROW_RE.test(c); })) continue;
      if (cells.some(function (c) { return c.indexOf('학교생활기록부') !== -1; })) continue;
      if (cells.some(function (c) { return PAGE_FOOTER_RE.test(c); })) continue;

      if (!colInfo) continue; // 아직 헤더를 못 만남 — 데이터 열을 모름

      var nameVal = rawCell(raw[colInfo.nameIdx]);
      var textVal = rawCell(raw[colInfo.textIdx]);
      var subjectValRaw = rawCell(raw[colInfo.subjectIdx]);
      var noVal = colInfo.noIdx !== -1 ? rawCell(raw[colInfo.noIdx]) : '';

      if (nameVal) {
        // 명명행: 새 학생 시작(또는 재등장). B가 있으면 과목 갱신·등록, 없으면 forward-fill
        namedRowCount += 1;
        if (subjectValRaw && subjectValRaw !== currentSubject) {
          currentSubject = subjectValRaw;
          rawSubjectSeq.push(subjectValRaw);
        }
        var key = normNo(noVal) + '|' + nameVal;
        var student = studentsMap.get(key);
        if (!student) {
          seq += 1;
          student = { id: seq, no: noVal, name: nameVal, entries: [] };
          studentsMap.set(key, student);
          order.push(key);
        }
        // 페이지 경계에서 성명 칸이 중복 기재된 연속행 방어: 같은 학생·같은 과목이 바로
        // 이어지면(직전 항목과 동일 키·동일 과목) 새 항목을 만들지 않고 텍스트만 이어붙인다.
        if (lastEntry && lastEntryOwnerKey === key && lastEntry.subject === currentSubject) {
          lastEntry.text += (lastEntry.text ? ' ' : '') + textVal;
        } else {
          var entry = { subject: currentSubject, text: textVal };
          student.entries.push(entry);
          lastEntry = entry;
          lastEntryOwnerKey = key;
        }
      } else if (textVal) {
        // 연속행: 직전 학생 세특에 이어붙임. B값(subjectValRaw)은 절대 과목으로 등록하지 않는다.
        if (lastEntry) {
          lastEntry.text += (lastEntry.text ? ' ' : '') + textVal;
        }
      }
      // else: 데이터 열이 전부 빈 행 — 무시
    }

    var students = order.map(function (k) { return studentsMap.get(k); });
    return { students: students, rawSubjectSeq: rawSubjectSeq, sourceLabel: sourceLabel, namedRowCount: namedRowCount };
  }

  // 과목명 잘림 보정(파싱 완료 후) — 명명행에서 등록된 과목들만 대상
  function finalizeSubjects(students, rawSubjectSeq) {
    var distinct = Array.from(new Set(rawSubjectSeq.filter(Boolean)));
    var mapping = {};
    distinct.forEach(function (a) {
      var target = null;
      var ambiguous = false;
      distinct.forEach(function (b) {
        if (a === b) return;
        if (b.indexOf(a) === 0) { // b.startsWith(a)
          if (target && target !== b) ambiguous = true;
          target = b;
        }
      });
      if (target && !ambiguous) mapping[a] = target;
    });
    // 체인(조각의 조각) 방어적 해소
    Object.keys(mapping).forEach(function (k) {
      var v = mapping[k];
      var guard = 0;
      while (mapping[v] && guard < 5) { v = mapping[v]; guard++; }
      mapping[k] = v;
    });

    students.forEach(function (st) {
      st.entries.forEach(function (e) {
        if (e.subject && mapping[e.subject]) e.subject = mapping[e.subject];
      });
    });

    var subjects = [];
    var seen = new Set();
    rawSubjectSeq.forEach(function (rawSubj) {
      var canon = mapping[rawSubj] || rawSubj;
      if (canon && !seen.has(canon)) { seen.add(canon); subjects.push(canon); }
    });

    var repairedSubjects = {};
    Object.keys(mapping).forEach(function (k) { if (k !== mapping[k]) repairedSubjects[k] = mapping[k]; });

    return { subjects: subjects, repairedSubjects: repairedSubjects };
  }

  // ====================================================================
  // §3 표준 모드 — 기존 앱(학교생활기록부 점검기.html) 로직 이식
  // ====================================================================

  // 프로파일 독립: 교과세특 + 창체 4종의 텍스트 컬럼 후보를 합친 범용 패턴
  var STD_TEXT_PATTERNS = /세부.?특기|특기.?사항|^세특$|과목.?세특|교과.?세특|동아리.?활동|진로.?활동|자율.?활동|행동.?특성|종합.?의견|행동특성및종합의견|행.?특/;
  var STD_TEXT_FALLBACK = ['세부능력및특기사항', '세부능력', '특기사항', '세특', '교과세특', '과목세특', '동아리활동', '진로활동', '자율활동', '행동특성및종합의견', '행동특성', '종합의견', '의견', '내용'];

  function stdFindCol(cells, candidates, exactOnly) {
    for (var i = 0; i < candidates.length; i++) {
      var exact = cells.indexOf(candidates[i]);
      if (exact !== -1) return exact;
    }
    if (exactOnly) return -1;
    for (var j = 0; j < candidates.length; j++) {
      var idx = cells.findIndex(function (c) { return c.indexOf(candidates[j]) !== -1; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function stdFindNameCol(cells) {
    var idx = cells.findIndex(function (c) {
      return /^(?:성명|이름|학생성명|학생명|성명\(.*\))$/.test(c) || c.indexOf('성명') !== -1 || c.indexOf('학생명') !== -1;
    });
    if (idx !== -1) return idx;
    return stdFindCol(cells, ['성명', '이름', '학생명', '학생성명']);
  }

  function stdFindTextCol(cells) {
    var idx = cells.findIndex(function (c) { return STD_TEXT_PATTERNS.test(c); });
    if (idx !== -1) return idx;
    return stdFindCol(cells, STD_TEXT_FALLBACK);
  }

  function findColumnIndices(rows) {
    for (var r = 0; r < Math.min(rows.length, 50); r++) {
      var cells = (rows[r] || []).map(normStripAll);
      if (!cells.some(Boolean)) continue;

      var nameIdx = stdFindNameCol(cells);
      var textIdx = stdFindTextCol(cells);
      if (nameIdx === -1 || textIdx === -1) continue;

      // NEIS 표준 양식의 '과목' 열(정확 일치만 — '과목코드'는 제외). 없으면 -1 → 파일명 유래 과목 사용
      var subjectIdx = cells.indexOf('과목');

      var slashIdx = cells.indexOf('반/번호');
      if (slashIdx !== -1) {
        return { headerRowIndex: r, noMode: 'slash', noIdx: slashIdx, nameIdx: nameIdx, textIdx: textIdx, subjectIdx: subjectIdx };
      }

      var banIdx = cells.indexOf('반');
      var beonIdx = cells.indexOf('번호');
      if (banIdx !== -1 && beonIdx !== -1 && banIdx !== beonIdx) {
        return { headerRowIndex: r, noMode: 'ban_beon', banIdx: banIdx, beonIdx: beonIdx, nameIdx: nameIdx, textIdx: textIdx, subjectIdx: subjectIdx };
      }

      var hakbunIdx = stdFindCol(cells, ['학번', '출석번호', '연번']);
      if (hakbunIdx !== -1) {
        return { headerRowIndex: r, noMode: 'hakbun', noIdx: hakbunIdx, nameIdx: nameIdx, textIdx: textIdx, subjectIdx: subjectIdx };
      }

      if (beonIdx !== -1) {
        return { headerRowIndex: r, noMode: 'beon', noIdx: beonIdx, nameIdx: nameIdx, textIdx: textIdx, subjectIdx: subjectIdx };
      }

      return { headerRowIndex: r, noMode: 'none', nameIdx: nameIdx, textIdx: textIdx, subjectIdx: subjectIdx };
    }
    return null;
  }

  function guessColumnIndices(rows) {
    for (var r = 0; r < Math.min(rows.length, 80); r++) {
      var row = rows[r] || [];
      var nameIdx = -1, textIdx = -1, noIdx = -1, bestLen = 0;
      row.forEach(function (cell, idx) {
        var s = (cell == null ? '' : String(cell)).trim();
        if (!s) return;
        if (/^[가-힣]{2,4}$/.test(s)) nameIdx = idx;
        if (/^\d{1,2}[-/]\d{1,2}$/.test(s) || /^\d{4,5}$/.test(s)) noIdx = idx;
        if (s.length > bestLen && s.length >= 40) { bestLen = s.length; textIdx = idx; }
      });
      if (nameIdx !== -1 && textIdx !== -1 && nameIdx !== textIdx) {
        var colInfo = { headerRowIndex: r, nameIdx: nameIdx, textIdx: textIdx, noMode: 'none', guessed: true };
        if (noIdx !== -1 && noIdx !== nameIdx && noIdx !== textIdx) {
          colInfo.noMode = 'beon';
          colInfo.noIdx = noIdx;
        }
        return colInfo;
      }
    }
    return null;
  }

  function getStudentNo(row, colInfo) {
    var noMode = colInfo.noMode, noIdx = colInfo.noIdx, banIdx = colInfo.banIdx, beonIdx = colInfo.beonIdx;
    if (noMode === 'none') return '';
    if (noMode === 'ban_beon') {
      var ban = (row[banIdx] == null ? '' : String(row[banIdx])).trim();
      var beon = (row[beonIdx] == null ? '' : String(row[beonIdx])).trim();
      if (ban && beon) return ban + '-' + beon;
      return ban || beon;
    }
    return (row[noIdx] == null ? '' : String(row[noIdx])).trim();
  }

  function isStdHeaderRow(rawNo, rawName, colInfo) {
    var nNo = normStripAll(rawNo);
    var nName = normStripAll(rawName);
    if (nNo === '반/번호' || nName === '성명') return true;
    if (colInfo.noMode === 'ban_beon' && (nNo === '반' || nNo === '번호')) return true;
    if (nName === '이름' || nName === '학생명') return true;
    return false;
  }

  function isLikelyName(s) {
    return /^[가-힣]{2,5}$/.test(s) && ['성명', '이름', '학생명', '학년', '학기', '반', '번호', '과목', '교과'].indexOf(s) === -1;
  }

  function parseNeisRows(rows, colInfo) {
    if (!colInfo) colInfo = findColumnIndices(rows) || guessColumnIndices(rows);
    if (!colInfo) return [];
    var nameIdx = colInfo.nameIdx, textIdx = colInfo.textIdx;
    var subjectIdx = colInfo.subjectIdx != null ? colInfo.subjectIdx : -1;

    var result = [];
    var current = null;
    var currentSubject = ''; // '과목' 열 forward-fill(병합셀·빈 셀 대비)
    var startRow = colInfo.guessed ? colInfo.headerRowIndex : colInfo.headerRowIndex + 1;

    for (var i = startRow; i < rows.length; i++) {
      var row = rows[i] || [];
      var rawNo = getStudentNo(row, colInfo);
      var rawName = (row[nameIdx] == null ? '' : String(row[nameIdx])).trim();
      var rawText = (row[textIdx] == null ? '' : String(row[textIdx])).trim();
      var rawSubject = subjectIdx !== -1 && row[subjectIdx] != null ? String(row[subjectIdx]).trim() : '';
      if (rawSubject) currentSubject = rawSubject;

      if (isStdHeaderRow(rawNo, rawName, colInfo)) continue;
      if (!rawNo && !rawName && !rawText) continue;

      if (isLikelyName(rawName)) {
        current = { no: rawNo, name: rawName, text: rawText, subject: currentSubject };
        result.push(current);
      } else if (rawName && rawText) {
        current = { no: rawNo, name: rawName, text: rawText, subject: currentSubject };
        result.push(current);
      } else if (!rawNo && !rawName && rawText && current) {
        current.text += (current.text ? ' ' : '') + rawText;
      }
    }

    return result.filter(function (r) { return r.name; });
  }

  function extractSubjectFromFileName(fileName) {
    var base = (fileName || '').replace(/\.(xlsx|xls)$/i, '');
    var seIdx = base.search(/과목.?세특|세부.?특기|세특/i);
    if (seIdx > 0) {
      var before = base.slice(0, seIdx).split(/[_\s·]+/).filter(Boolean);
      for (var i = before.length - 1; i >= 0; i--) {
        if (/^[가-힣]{2,10}$/.test(before[i])) return before[i];
      }
    }
    var parts = base.split(/[_\s·]+/).filter(function (p) { return /^[가-힣]{2,10}$/.test(p); });
    return parts.length ? parts[parts.length - 1] : base.slice(0, 16);
  }

  function parseStandard(rows, fileName) {
    var colInfo = findColumnIndices(rows) || guessColumnIndices(rows);
    if (!colInfo) return { students: [], subjects: [], repairedSubjects: {}, sourceLabel: fileName || '', format: 'standard' };
    var parsed = parseNeisRows(rows, colInfo);
    // 과목명은 파일 내 '과목' 열 값을 최우선으로 쓰고(NEIS 표준 양식), 없으면 파일명에서 추출
    var fallbackLabel = extractSubjectFromFileName(fileName || '');
    var subjects = [];
    var students = parsed.map(function (p, i) {
      var subj = p.subject || fallbackLabel;
      if (subj && subjects.indexOf(subj) === -1) subjects.push(subj);
      return { id: i + 1, no: p.no, name: p.name, entries: [{ subject: subj, text: p.text }] };
    });
    return { students: students, subjects: subjects, repairedSubjects: {}, sourceLabel: fileName || '', format: 'standard' };
  }

  // ====================================================================
  // 진입점
  // ====================================================================
  function emptyResult(fileName) {
    return { students: [], subjects: [], repairedSubjects: {}, sourceLabel: fileName || '', format: 'unknown' };
  }

  function parseWorkbook(workbook, opts) {
    opts = opts || {};
    var fileName = opts.fileName || '';
    var XLSX = g.XLSX;
    if (!XLSX) throw new Error('SGB.parse.parseWorkbook: XLSX가 로드되지 않았습니다 (assets/vendor/xlsx.full.min.js 먼저 로드).');
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) return emptyResult(fileName);
    var sheetName = (opts.sheetName && workbook.Sheets[opts.sheetName]) ? opts.sheetName : workbook.SheetNames[0];
    var ws = workbook.Sheets[sheetName];
    if (!ws) return emptyResult(fileName);

    var rows = sheetToRows(XLSX, ws);
    if (!rows.length) return emptyResult(fileName);

    var format = detectFormat(rows);
    if (format === 'printdump') {
      var parsedDump = parsePrintDump(rows);
      var finalized = finalizeSubjects(parsedDump.students, parsedDump.rawSubjectSeq);
      return {
        students: parsedDump.students,
        subjects: finalized.subjects,
        repairedSubjects: finalized.repairedSubjects,
        sourceLabel: parsedDump.sourceLabel || fileName,
        format: 'printdump',
        namedRowCount: parsedDump.namedRowCount // 진단용 부가 필드(§2b 계약 외) — 골든 오라클 검증용
      };
    }
    return parseStandard(rows, fileName);
  }

  // §4/다중 파일 병합: 번호|성명 키로 학생을 합치고 entries를 이어붙인다.
  // 같은 학생에 같은 과목 entry가 이미 있으면(재업로드 등) push 대신 교체한다(최신 파일 우선).
  // 반환 배열에 replacedCount를 부가 프로퍼티로 실어 호출부가 "교체됨" 알림을 띄울 수 있게 한다.
  function mergeStudents(existing, parsed) {
    var list = Array.isArray(existing) ? existing.slice() : [];
    var map = new Map();
    var maxId = 0;
    list.forEach(function (st) {
      map.set(normNo(st.no) + '|' + st.name, st);
      if (st.id > maxId) maxId = st.id;
    });
    var replacedCount = 0;
    (parsed || []).forEach(function (p) {
      var key = normNo(p.no) + '|' + p.name;
      var st = map.get(key);
      if (!st) {
        maxId += 1;
        st = { id: maxId, no: p.no, name: p.name, entries: [] };
        map.set(key, st);
        list.push(st);
      }
      (p.entries || []).forEach(function (e) {
        var dup = st.entries.filter(function (existingEntry) { return existingEntry.subject === e.subject; })[0];
        if (dup) {
          dup.text = e.text;
          replacedCount += 1;
        } else {
          st.entries.push(e);
        }
      });
    });
    list.replacedCount = replacedCount;
    return list;
  }

  g.SGB.parse = {
    parseWorkbook: parseWorkbook,
    mergeStudents: mergeStudents,
    // 테스트/디버깅 편의를 위한 내부 유틸 노출(계약 외 — 사용은 권장하지 않음)
    _internal: {
      recomputeRef: recomputeRef,
      detectFormat: detectFormat,
      parsePrintDump: parsePrintDump,
      finalizeSubjects: finalizeSubjects,
      findColumnIndices: findColumnIndices,
      guessColumnIndices: guessColumnIndices,
      parseNeisRows: parseNeisRows,
      extractSubjectFromFileName: extractSubjectFromFileName
    }
  };
})();
