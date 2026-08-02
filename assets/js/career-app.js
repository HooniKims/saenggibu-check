/*
 * career.html 페이지 컨트롤러 — DOM·이벤트·상태(localStorage `sgb_career_v1`).
 * 창체 전용 파싱(활동유형 자동감지·진로묶음 파서 등)은 SGB.parse가 모르는 영역이라
 * 여기서 이식한다(원본: 학교생활기록부 창체점검기.html). 일반 학생 목록 파싱은
 * SGB.parse.parseWorkbook을 그대로 활용한다. 규칙 판정은 SGB.rulesCareer.scan에 위임.
 */
(function () {
  'use strict';

  var SGB = window.SGB;
  var RC = SGB.rulesCareer;
  var PROFILES = RC.PROFILES;
  var STORAGE_KEY = 'sgb_career_v1';
  var UI_STATE_KEY = STORAGE_KEY + '_ui';

  // 텍스트영역 입력마다 전체 상태(localStorage) 직렬화가 도는 것을 막기 위한 디바운스.
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }
  var debouncedSaveState = debounce(function () { saveState(); }, 300);

  var RULE_TAGS = {
    PROHIBITED: '기재불가',
    ORG: '기관·사교육',
    CAUTION: '기재유의어',
    QUOTE: '따옴표',
    MIDDOT: '가운뎃점',
    PARENROMAN: '괄호영문',
    PLACEHOLDER: '형식표현',
    FLOWERY: '미사여구',
    CAREER_LACK: '진로연계부족',
    PROCESS_LACK: '과정부족',
    SPECULATIVE: '추측표현',
    PATTERN: '패턴반복',
    TEMPLATE: '템플릿',
    ENDING: '종결혼용',
    SPACING: '띄어쓰기',
    DUP: '문장중복',
    BYTE: '바이트초과',
    CHAR: '글자수초과'
  };

  function legendForProfile(p) {
    return [
      { label: '기재불가(대회·시험·논문 등)', color: 'm-red' },
      { label: '기관·사교육 언급', color: 'm-brown' },
      { label: '기재 유의어·표기', color: 'm-brown' },
      { label: '형식·미사여구', color: 'm-amber' },
      { label: p.checkCareerLack ? '진로연계 부족' : '과정·역할 부족', color: 'm-rose' },
      { label: '패턴·템플릿 반복', color: 'm-violet' },
      { label: '문장 중복', color: 'm-teal' },
      { label: '띄어쓰기·표기 형식', color: 'm-slate' }
    ];
  }

  // ------------------------------------------------------------------
  // 상태
  // ------------------------------------------------------------------
  var students = []; // [{id, no, name, text}]
  var seq = 0;
  var activityType = 'club';
  var sourceLabel = '';
  var resultsData = null; // 분석 결과(§ analyzeAll 참고)

  // UI 표시 상태(데이터 아님) — 별도 키에 저장, 기존 STORAGE_KEY 상태 스키마는 건드리지 않는다.
  var uiState = SGB.core.loadState(UI_STATE_KEY) || {};
  var studentsCollapsed = !!uiState.cardsCollapsed;
  var onlyViolations = !!uiState.onlyViolations;
  var onlyWithIssues = !!uiState.onlyWithIssues;

  function saveUiState() {
    SGB.core.saveState(UI_STATE_KEY, {
      cardsCollapsed: studentsCollapsed,
      onlyViolations: onlyViolations,
      onlyWithIssues: onlyWithIssues
    });
  }

  // 확정 위반만 보기(§P1) — grade가 있는 항목(규칙 판정)은 violation만 통과,
  // grade가 없는 항목(바이트·글자수 초과)은 명백한 초과라 항상 통과시킨다.
  function passesViolationFilter(it) {
    return !onlyViolations || !it.grade || it.grade === 'violation';
  }

  // ------------------------------------------------------------------
  // DOM 참조
  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  var activityTabsEl = $('activityTabs');
  var typeDescEl = $('typeDesc');
  var neisGuideEl = $('neisGuide');
  var uploadZoneEl = $('uploadZone');
  var fileInputEl = $('fileInput');
  var browseBtnEl = $('browseBtn');
  var uploadHintEl = $('uploadHint');
  var uploadStatusEl = $('uploadStatus');
  var byteLimitEl = $('byteLimit');
  var byteHintEl = $('byteHint');
  var sourceInfoEl = $('sourceInfo');
  var legendEl = $('legend');
  var legendDetailsEl = $('legendDetails');
  var cardsContainerEl = $('cardsContainer');
  var studentsToggleEl = $('studentsToggle');
  var studentsToggleLabelEl = $('studentsToggleLabel');
  var addBtnEl = $('addBtn');
  var clearBtnEl = $('clearBtn');
  var analyzeBtnEl = $('analyzeBtn');
  var analyzeBtnDefaultLabel = analyzeBtnEl.textContent;
  var resultsHeadlineEl = $('resultsHeadline');
  var resultsSummaryEl = $('resultsSummary');
  var actionBarEl = $('actionBar');
  var actionBarLabelEl = $('actionBarLabel');
  var exportSummaryBtnEl = $('exportSummaryBtn');
  var copyIssuesBtnEl = $('copyIssuesBtn');
  var resultsControlsEl = $('resultsControls');
  var onlyViolationsToggleEl = $('onlyViolationsToggle');
  var onlyIssuesToggleEl = $('onlyIssuesToggle');
  var resultsBodyEl = $('resultsBody');

  function getProfile() { return PROFILES[activityType] || PROFILES.club; }
  function getLimit() { return Number(byteLimitEl.value) || getProfile().byteLimit; }

  // ------------------------------------------------------------------
  // 프로파일 UI (탭·NEIS 경로 안내·범례·설정행)
  // ------------------------------------------------------------------
  function renderNeisGuide() {
    var p = getProfile();
    var pathHtml = p.neisPath.map(function (step, i) {
      return (i ? '<span class="neis-guide__sep">›</span>' : '') + '<span>' + SGB.core.escapeHtml(step) + '</span>';
    }).join('');
    neisGuideEl.innerHTML =
      '<p class="neis-guide__label">NEIS에서 아래 메뉴 경로로 <strong>학생부 자료기록 → 출력(XLS data)</strong>한 파일을 선택하세요</p>' +
      '<div class="neis-guide__path">' + pathHtml + '</div>' +
      (p.fileExample ? '<p class="neis-guide__example">' + SGB.core.escapeHtml(p.fileExample) + '</p>' : '') +
      (p.uploadNote ? '<p class="neis-guide__note">' + SGB.core.escapeHtml(p.uploadNote) + '</p>' : '');
  }

  function renderLegend() {
    var p = getProfile();
    legendEl.innerHTML = legendForProfile(p).map(function (item) {
      return '<span class="legend-item"><span class="legend-swatch ' + item.color + '"></span>' + SGB.core.escapeHtml(item.label) + '</span>';
    }).join('');
  }

  function applyProfileUI() {
    var p = getProfile();
    Array.prototype.forEach.call(activityTabsEl.querySelectorAll('.toggle-btn'), function (btn) {
      var on = btn.dataset.type === activityType;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    typeDescEl.textContent = p.desc;
    renderNeisGuide();
    renderLegend();
    byteLimitEl.value = p.byteLimit;
    var charPart = p.charLimit ? (' · 글자 ' + p.charLimit + '자 권고') : (' · ' + (p.charHint || ''));
    byteHintEl.textContent = '바이트 (NEIS EUC-KR · 한글 1자 = 2바이트' + charPart + ')';
    sourceInfoEl.textContent = sourceLabel ? ('· ' + sourceLabel) : '';
    uploadHintEl.textContent = '선택한 ' + p.label + ' 파일의 학생·특기사항을 자동으로 불러옵니다. 여러 파일을 한 번에 올리면 성명·번호 기준으로 자동 합쳐집니다.';
    Array.prototype.forEach.call(cardsContainerEl.querySelectorAll('textarea[data-role="text"]'), function (ta) {
      ta.placeholder = p.placeholder;
    });
    students.forEach(function (s) { updateByteDisplay(s.id); });
  }

  // ------------------------------------------------------------------
  // 학생 카드 (학생자료 편집)
  // ------------------------------------------------------------------
  // subject.html 결과 빈 상태와 동일한 문서+체크 아이콘 계열로 통일(§P2 — 봉투 아이콘 지양).
  function emptyIllusHtml(labelText) {
    return (
      '<div class="illus illus-empty" role="img" aria-label="' + SGB.core.escapeHtml(labelText) + '">' +
        '<img src="./assets/img/empty-state.png" alt="" onerror="this.style.display=\'none\';this.closest(\'.illus\').classList.add(\'img-missing\')">' +
        '<div class="illus-fallback" aria-hidden="true">' +
          '<svg class="illus-fallback-icon" viewBox="0 0 96 96" width="64" height="64" fill="none" aria-hidden="true">' +
            '<rect x="20" y="16" width="56" height="64" rx="6" fill="#FFFFFF" stroke="#4F46E5" stroke-width="3"/>' +
            '<path d="M32 46 L44 58 L66 32" stroke="#4F46E5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
          '</svg>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // 학생자료 편집 영역 접기/펼치기(§P1) — 업로드로 채워지면 자동 접힘,
  // 직접 추가로 작업 중일 땐 펼침 유지. 접힘 상태는 UI_STATE_KEY에 보존.
  // ------------------------------------------------------------------
  function updateStudentsToggleUI() {
    studentsToggleEl.setAttribute('aria-expanded', studentsCollapsed ? 'false' : 'true');
    cardsContainerEl.hidden = studentsCollapsed;
    studentsToggleLabelEl.textContent = studentsCollapsed
      ? ('학생 자료 ' + students.length + '명 — 펼쳐서 수정')
      : '학생 자료';
  }
  function setStudentsCollapsed(collapsed) {
    studentsCollapsed = collapsed;
    updateStudentsToggleUI();
    saveUiState();
  }
  studentsToggleEl.addEventListener('click', function () { setStudentsCollapsed(!studentsCollapsed); });

  // ------------------------------------------------------------------
  // 결과로 스크롤(§P0) — 점검 실행/업로드 완료 시 헤드라인 앵커로 이동.
  // ------------------------------------------------------------------
  function scrollToResults() {
    if (resultsHeadlineEl && !resultsHeadlineEl.hidden && resultsHeadlineEl.scrollIntoView) {
      resultsHeadlineEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function addStudent(no, name, text) {
    seq += 1;
    students.push({ id: seq, no: no || '', name: name || '', text: text || '' });
    renderCards();
    saveState();
  }

  function removeStudent(id) {
    students = students.filter(function (s) { return s.id !== id; });
    renderCards();
    saveState();
  }

  function renderCards() {
    var p = getProfile();
    if (!students.length) {
      cardsContainerEl.innerHTML =
        '<div class="empty-state">' + emptyIllusHtml('빈 학생 목록') +
          '<p>아직 학생이 없습니다. 위에서 엑셀을 올리거나 "+ 학생 직접 추가"를 눌러주세요.</p>' +
        '</div>';
      updateStudentsToggleUI();
      return;
    }

    cardsContainerEl.innerHTML = students.map(function (s) {
      return (
        '<div class="card student-edit-card" data-id="' + s.id + '">' +
          '<div class="student-edit-card__head">' +
            '<input type="text" class="student-edit-card__no" placeholder="번호" value="' + SGB.core.escapeHtml(s.no) + '" data-role="no" data-id="' + s.id + '">' +
            '<input type="text" class="student-edit-card__name" placeholder="성명" value="' + SGB.core.escapeHtml(s.name) + '" data-role="name" data-id="' + s.id + '">' +
            '<button type="button" class="student-edit-card__remove" data-role="remove" data-id="' + s.id + '">삭제</button>' +
          '</div>' +
          '<textarea placeholder="' + SGB.core.escapeHtml(p.placeholder) + '" data-role="text" data-id="' + s.id + '">' + SGB.core.escapeHtml(s.text) + '</textarea>' +
          '<div class="student-edit-card__meta">' +
            '<div class="gauge" data-role="gauge" data-id="' + s.id + '"><div class="gauge-fill"></div></div>' +
            '<span class="student-edit-card__count" data-role="count" data-id="' + s.id + '"></span>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    Array.prototype.forEach.call(cardsContainerEl.querySelectorAll('[data-role="no"]'), function (el) {
      el.addEventListener('input', function (e) {
        var id = Number(e.target.dataset.id);
        var st = students.filter(function (s) { return s.id === id; })[0];
        if (st) st.no = e.target.value;
        saveState();
      });
    });
    Array.prototype.forEach.call(cardsContainerEl.querySelectorAll('[data-role="name"]'), function (el) {
      el.addEventListener('input', function (e) {
        var id = Number(e.target.dataset.id);
        var st = students.filter(function (s) { return s.id === id; })[0];
        if (st) st.name = e.target.value;
        saveState();
      });
    });
    Array.prototype.forEach.call(cardsContainerEl.querySelectorAll('[data-role="text"]'), function (el) {
      el.addEventListener('input', function (e) {
        var id = Number(e.target.dataset.id);
        var st = students.filter(function (s) { return s.id === id; })[0];
        if (st) st.text = e.target.value;
        updateByteDisplay(id);
        debouncedSaveState(); // 텍스트영역은 키 입력마다 전체 상태 저장이 돌지 않도록 300ms 디바운스
      });
    });
    Array.prototype.forEach.call(cardsContainerEl.querySelectorAll('[data-role="remove"]'), function (el) {
      el.addEventListener('click', function (e) { removeStudent(Number(e.target.dataset.id)); });
    });

    students.forEach(function (s) { updateByteDisplay(s.id); });
    updateStudentsToggleUI();
  }

  function updateByteDisplay(id) {
    var st = students.filter(function (s) { return s.id === id; })[0];
    if (!st) return;
    var p = getProfile();
    var limit = getLimit();
    var bytes = SGB.core.byteLen(st.text, 'neis2');
    var chars = SGB.core.charLen(st.text);
    var gaugeEl = cardsContainerEl.querySelector('[data-role="gauge"][data-id="' + id + '"]');
    var countEl = cardsContainerEl.querySelector('[data-role="count"][data-id="' + id + '"]');
    if (gaugeEl) SGB.core.renderGauge(gaugeEl, chars, bytes, limit);
    if (countEl) {
      var overChar = !!(p.charLimit && chars > p.charLimit);
      var charNote = p.charLimit ? (' · ' + chars + '/' + p.charLimit + '자') : '';
      countEl.textContent = chars + '자 · ' + bytes + ' / ' + limit + 'B' + charNote;
      countEl.classList.toggle('over', bytes > limit || overChar);
    }
  }

  // ------------------------------------------------------------------
  // 창체 전용 파싱 (원본 이식 — SGB.parse가 모르는 영역)
  // ------------------------------------------------------------------
  function normCell(c) { return (c == null ? '' : String(c)).replace(/\s+/g, '').replace(/﻿/g, ''); }
  function normStudentKey(no) { return (no || '').toString().replace(/\s+/g, ''); }
  function isLikelyName(s) {
    return /^[가-힣]{2,5}$/.test(s) && ['성명', '이름', '학생명', '학년', '학기', '반', '번호', '과목', '교과'].indexOf(s) === -1;
  }

  function detectActivityTypeFromRows(rows) {
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var line = (rows[r] || []).map(function (c) { return (c == null ? '' : String(c)); }).join(' ');
      if (/동아리\s*활동/.test(line)) return 'club';
      if (/진로\s*활동/.test(line)) return 'career';
      if (/자율\s*활동/.test(line)) return 'auto';
      if (/행동\s*특성|종합\s*의견|행동특성/.test(line)) return 'behavior';
    }
    return null;
  }

  function extractSourceLabelFromRows(rows) {
    for (var r = 0; r < Math.min(rows.length, 6); r++) {
      var cells = (rows[r] || []).map(function (c) { return (c == null ? '' : String(c)).trim(); }).filter(Boolean);
      var joined = cells.join(' ');
      if (/학년도/.test(joined) && cells[0] && cells[0].length <= 30) return cells[0];
    }
    return '';
  }

  function extractSubjectFromFileName(fileName) {
    var base = (fileName || '').replace(/\.(xlsx|xls)$/i, '');
    if (/동아리/.test(base)) return '동아리활동';
    if (/진로/.test(base)) return '진로활동';
    if (/자율/.test(base)) return '자율활동';
    if (/행동|행특|종합의견/.test(base)) return '행동특성및종합의견';
    var parts = base.split(/[_\s·]+/).filter(function (p) { return /^[가-힣]{2,12}$/.test(p); });
    return parts.length ? parts[parts.length - 1] : base.slice(0, 16);
  }

  function isCareerBundleFormat(rows) {
    for (var r = 0; r < Math.min(rows.length, 8); r++) {
      var line = (rows[r] || []).map(function (c) { return (c == null ? '' : String(c)); }).join(' ');
      if (/진로\s*활동/.test(line) && /학생부/.test(line)) return true;
    }
    return false;
  }

  function findCareerBundleHeaderRow(rows) {
    for (var r = 0; r < Math.min(rows.length, 25); r++) {
      var cells = (rows[r] || []).map(normCell);
      if (!cells.some(Boolean)) continue;
      if (cells.indexOf('번호') !== -1 && cells.indexOf('성명') !== -1 && cells.some(function (c) { return /특기.?사항/.test(c); })) return r;
    }
    return -1;
  }

  function formatBundleStudentNo(raw) {
    var s = (raw == null ? '' : String(raw)).trim();
    if (!s) return '';
    if (/^\d+\.0$/.test(s)) return String(parseInt(s, 10));
    return s;
  }

  function isCareerBundleInfoRow(row) {
    var name = (row[1] == null ? '' : String(row[1])).trim();
    var no = (row[0] == null ? '' : String(row[0])).trim();
    return !!no && isLikelyName(name);
  }

  function parseCareerBundleRows(rows) {
    var headerRow = findCareerBundleHeaderRow(rows);
    if (headerRow === -1) return [];
    var textIdx = 3;
    var result = [];
    var current = null;

    for (var i = headerRow + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var no = formatBundleStudentNo(row[0]);
      var name = (row[1] == null ? '' : String(row[1])).trim();
      var textCell = (row[textIdx] == null ? '' : String(row[textIdx])).trim();
      var hopeField = (row[4] == null ? '' : String(row[4])).trim();

      if (isCareerBundleInfoRow(row)) {
        if (current && name === current.name && normStudentKey(no) === normStudentKey(current.no)) continue;
        var parts = [];
        if (textCell === '희망분야' && hopeField) parts.push('[희망분야: ' + hopeField + ']');
        current = { no: no || '', name: name, text: parts.join('\n') };
        result.push(current);
        continue;
      }

      if (!textCell || textCell === '희망분야') continue;
      if (!current) continue;
      current.text += (current.text ? ' ' : '') + textCell;
    }

    return result.filter(function (r) { return r.name; });
  }

  // ------------------------------------------------------------------
  // 엑셀 불러오기
  // ------------------------------------------------------------------
  function readWorkbookFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          resolve({ name: file.name, workbook: XLSX.read(data, { type: 'array', cellDates: false }) });
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('read fail')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function readRawRows(workbook, sheetName) {
    var ws = workbook.Sheets[sheetName || workbook.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  }

  // 파일 1개를 {no,name,text}[] 로 변환. 진로묶음 형식은 전용 파서, 그 외는 SGB.parse 위임.
  function parseWorkbookToStudents(workbook, fileName) {
    var sheetName = workbook.SheetNames[0];
    var rows = readRawRows(workbook, sheetName);
    if (!rows.length) return { parsed: [], detectedType: null, sourceLabel: '' };

    var detectedType = detectActivityTypeFromRows(rows);
    var detectedSourceLabel = extractSourceLabelFromRows(rows) || extractSubjectFromFileName(fileName || '');

    var parsed;
    if (isCareerBundleFormat(rows)) {
      parsed = parseCareerBundleRows(rows);
    } else {
      var result = SGB.parse.parseWorkbook(workbook, { fileName: fileName, sheetName: sheetName });
      parsed = (result.students || []).map(function (st) {
        var text = (st.entries || []).map(function (e) { return e.text; }).filter(Boolean).join(' ');
        return { no: st.no, name: st.name, text: text };
      });
    }

    return { parsed: parsed, detectedType: detectedType, sourceLabel: detectedSourceLabel };
  }

  function mergeParsedByStudent(fileResults) {
    var merged = new Map();
    fileResults.forEach(function (fr) {
      var label = extractSubjectFromFileName(fr.fileName);
      fr.parsed.forEach(function (p) {
        var key = normStudentKey(p.no) + '|' + p.name;
        if (!merged.has(key)) merged.set(key, { no: p.no, name: p.name, parts: [] });
        merged.get(key).parts.push({ label: label, text: p.text });
      });
    });
    return merged;
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    uploadStatusEl.textContent = '불러오는 중…';
    uploadStatusEl.className = 'upload-status';

    var fileResults = [];
    var errors = [];
    var detectedType = null;
    var newSourceLabel = '';

    var chain = files.reduce(function (p, file) {
      return p.then(function () {
        return readWorkbookFile(file).then(function (read) {
          var out = parseWorkbookToStudents(read.workbook, read.name);
          if (!out.parsed.length) {
            errors.push(file.name + ': 데이터 없음');
            return;
          }
          if (!detectedType && out.detectedType) detectedType = out.detectedType;
          if (!newSourceLabel && out.sourceLabel) newSourceLabel = out.sourceLabel;
          fileResults.push({ fileName: read.name, parsed: out.parsed });
        }).catch(function () {
          errors.push(file.name + ': 읽기 실패');
        });
      });
    }, Promise.resolve());

    chain.then(function () {
      if (!fileResults.length) {
        uploadStatusEl.textContent = errors.length ? errors.join(' · ') : '불러올 학생이 없습니다.';
        uploadStatusEl.classList.add('err');
        return;
      }

      if (detectedType && detectedType !== activityType) activityType = detectedType;
      if (newSourceLabel) sourceLabel = newSourceLabel;

      var merged = mergeParsedByStudent(fileResults);
      students = [];
      seq = 0;
      resultsData = null;
      merged.forEach(function (m) {
        seq += 1;
        var text = m.parts.length === 1 ? m.parts[0].text : m.parts.map(function (part) { return '[' + part.label + ']\n' + part.text; }).join('\n\n');
        students.push({ id: seq, no: m.no, name: m.name, text: text });
      });

      applyProfileUI();
      setStudentsCollapsed(true); // 업로드로 학생자료가 채워지면 편집 목록은 자동으로 접는다
      renderCards();
      analyzeAll(); // 업로드 즉시 점검 결과 표시(내부에서 renderResults·saveState까지 처리)
      scrollToResults();

      var prefix = '파일 ' + fileResults.length + '개';
      if (errors.length) prefix += ' (' + errors.join(', ') + ')';
      uploadStatusEl.textContent = prefix + ' · ' + getProfile().label + (sourceLabel ? ' · ' + sourceLabel : '') + ' · 학생 ' + merged.size + '명 불러오기 완료';
      uploadStatusEl.classList.add('ok');
      uploadStatusEl.classList.remove('err');
    });
  }

  // ------------------------------------------------------------------
  // 점검 실행
  // ------------------------------------------------------------------
  function analyzeAll() {
    if (!students.length) {
      resultsData = null;
      renderResults();
      saveState();
      return;
    }

    var limit = getLimit();
    var profile = getProfile();
    var dupByStudent = RC.findCrossDuplicates(students);

    var rows = [];
    var perStudent = [];
    var totalIssues = 0;
    var overCount = 0;

    students.forEach(function (st) {
      var findings = RC.scan(st.text, profile);
      (dupByStudent[st.id] || []).forEach(function (m) {
        findings.push({ rule: 'DUP', grade: 'check', span: [m.start, m.end], quote: m.match, note: '다른 학생과 문장 중복', color: 'm-teal' });
      });

      var bytes = SGB.core.byteLen(st.text, 'neis2');
      var chars = SGB.core.charLen(st.text);
      var overByte = bytes > limit;
      var overChar = !!(profile.charLimit && chars > profile.charLimit);
      var over = overByte || overChar;
      if (over) overCount += 1;

      var issueRowsForExport = [];
      var issueItems = [];
      if (overByte) {
        issueItems.push({ tag: RULE_TAGS.BYTE, color: 'm-red', note: chars + '자 · ' + bytes + ' / ' + limit + ' 바이트', quote: '' });
        issueRowsForExport.push('바이트 초과 (' + chars + '자, ' + bytes + '/' + limit + ')');
      }
      if (overChar) {
        issueItems.push({ tag: RULE_TAGS.CHAR, color: 'm-red', note: chars + ' / ' + profile.charLimit + '자 (교육부 권고)', quote: '' });
        issueRowsForExport.push('글자수 초과 (' + chars + '/' + profile.charLimit + '자)');
      }
      findings.forEach(function (f) {
        var excerpt = f.quote && f.quote.length > 40 ? f.quote.slice(0, 40) + '…' : (f.quote || '');
        var tag = RULE_TAGS[f.rule] || f.rule;
        issueItems.push({ tag: tag, color: f.color, note: f.note, quote: excerpt, grade: f.grade });
        issueRowsForExport.push('[' + tag + '] ' + excerpt + ' - ' + f.note);
      });
      totalIssues += issueItems.length;

      perStudent.push({
        id: st.id, no: st.no, name: st.name,
        chars: chars, bytes: bytes, over: over,
        text: st.text, findings: findings, issues: issueItems
      });

      rows.push({
        '활동구분': profile.label, '출처': sourceLabel, '번호': st.no, '성명': st.name,
        '글자수': chars, '바이트': bytes, '제한': limit, '초과여부': over ? 'Y' : '',
        '이슈수': issueItems.length, '이슈상세': issueRowsForExport.join(' | ')
      });
    });

    resultsData = {
      profileLabel: profile.label,
      sourceLabel: sourceLabel,
      limit: limit,
      students: perStudent,
      rows: rows,
      summary: { count: students.length, issues: totalIssues, over: overCount },
      generatedAt: new Date().toISOString()
    };

    renderResults();
    saveState();
  }

  // ------------------------------------------------------------------
  // 결과 렌더
  // ------------------------------------------------------------------
  function issueItemHtml(it) {
    return '<div class="issue-item"><span class="issue-tag ' + it.color + '">' + SGB.core.escapeHtml(it.tag) + '</span>' +
      '<span class="issue-item__note">' + (it.quote ? '"' + SGB.core.escapeHtml(it.quote) + '" — ' : '') + SGB.core.escapeHtml(it.note) + '</span></div>';
  }

  // 같은 태그의 다수 발생을 1행으로 접는다(§P1) — 확정 위반만 보기 필터도 여기서 적용.
  function buildIssuesHtml(issues) {
    var filtered = issues.filter(passesViolationFilter);
    if (!filtered.length) return '<p class="issue-clean">발견된 문제 표현 없음</p>';
    var groups = SGB.core.groupBy(filtered, function (it) { return it.tag; });
    var html = groups.map(function (g, gi) {
      if (g.items.length === 1) return issueItemHtml(g.items[0]);
      var first = g.items[0];
      var uid = 'ig-' + Math.random().toString(36).slice(2, 8) + '-' + gi;
      return '' +
        '<div class="issue-group">' +
          '<button type="button" class="issue-item issue-group__toggle" data-role="issue-group-toggle" data-target="' + uid + '" aria-expanded="false">' +
            '<span class="issue-tag ' + first.color + '">' + SGB.core.escapeHtml(first.tag) + '</span>' +
            '<span class="issue-item__note">' + (first.quote ? '\'' + SGB.core.escapeHtml(first.quote) + '\' 외 ' : '') + (g.items.length - 1) + '건</span>' +
            '<svg class="issue-group__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9 L12 15 L18 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="issue-group__body" id="' + uid + '" hidden>' + g.items.map(issueItemHtml).join('') + '</div>' +
        '</div>';
    }).join('');
    return '<div class="issue-list">' + html + '</div>';
  }

  function studentVisibleIssueCount(st) {
    return st.issues.filter(passesViolationFilter).length;
  }

  function renderResults() {
    if (!resultsData || !resultsData.students.length) {
      actionBarEl.hidden = true;
      resultsControlsEl.hidden = true;
      legendDetailsEl.hidden = true;
      resultsHeadlineEl.hidden = true;
      // 학생이 아예 없으면 편집 영역의 빈 메시지와 중복되므로 결과 빈 상태는 숨긴다(§P2 단일 빈상태).
      if (students.length) {
        resultsSummaryEl.innerHTML =
          '<div class="empty-state">' + emptyIllusHtml('점검 결과 없음') +
            '<p>먼저 "전체 점검하기"를 실행하세요.</p>' +
          '</div>';
      } else {
        resultsSummaryEl.innerHTML = '';
      }
      resultsBodyEl.innerHTML = '';
      return;
    }

    var s = resultsData.summary;
    resultsHeadlineEl.hidden = false;
    resultsHeadlineEl.textContent = '학생 ' + s.count + '명 · 이슈 ' + s.issues + '건 발견';

    resultsSummaryEl.innerHTML =
      '<div class="stats-row">' +
        '<div class="stat"><span class="stat-value">' + s.count + '</span><span class="stat-label">학생</span></div>' +
        '<div class="stat"><span class="stat-value">' + s.issues + '</span><span class="stat-label">이슈</span></div>' +
        '<div class="stat"><span class="stat-value">' + s.over + '</span><span class="stat-label">바이트·글자수 초과</span></div>' +
      '</div>';

    actionBarEl.hidden = false;
    resultsControlsEl.hidden = false;
    legendDetailsEl.hidden = false;
    actionBarLabelEl.textContent = resultsData.profileLabel + ' · 학생 ' + s.count + '명 · 이슈 ' + s.issues + '건';

    var visibleStudents = onlyWithIssues
      ? resultsData.students.filter(function (st) { return studentVisibleIssueCount(st) > 0; })
      : resultsData.students;
    var countBadge = (onlyWithIssues && visibleStudents.length !== resultsData.students.length)
      ? (visibleStudents.length + '/' + resultsData.students.length + '명 표시')
      : (s.count + '명');
    var visibleIssuesTotal = resultsData.students.reduce(function (sum, st) { return sum + studentVisibleIssueCount(st); }, 0);

    var studentsHtml = visibleStudents.map(function (st) {
      // st.findings/st.text는 구 버전 캐시(localStorage)엔 없을 수 있다 — 있으면 재필터링,
      // 없으면 예전에 저장된 annotated HTML로 안전하게 대체(크래시 방지).
      var annotated;
      if (st.findings) {
        var visibleFindings = onlyViolations ? st.findings.filter(function (f) { return f.grade === 'violation'; }) : st.findings;
        annotated = SGB.core.buildAnnotatedHtml(st.text, visibleFindings);
      } else {
        annotated = st.annotated || '';
      }
      var issuesHtml = buildIssuesHtml(st.issues || []);

      return (
        '<div class="student-card">' +
          '<div class="student-card__header">' +
            '<span><span class="student-card__name">' + SGB.core.escapeHtml(st.name || '(이름 미입력)') + '</span>' +
            (st.no ? '<span class="student-card__no">' + SGB.core.escapeHtml(st.no) + '</span>' : '') + '</span>' +
            '<span class="student-card__gauge-wrap"><span class="student-card__gauge-label">' + st.chars + '자 · ' + st.bytes + ' / ' + resultsData.limit + 'B' + (st.over ? ' · 초과' : '') + '</span></span>' +
          '</div>' +
          '<div class="annotated">' + (annotated || '<span class="issue-item__note">내용 없음</span>') + '</div>' +
          issuesHtml +
        '</div>'
      );
    }).join('');

    resultsBodyEl.innerHTML =
      '<div class="subject-section">' +
        '<div class="subject-section-header">' +
          '<h2>' + SGB.core.escapeHtml(resultsData.profileLabel) + '<span class="badge">' + SGB.core.escapeHtml(countBadge) + '</span></h2>' +
          '<span class="subject-section-meta">이슈 ' + visibleIssuesTotal + '건 · 초과 ' + s.over + '명</span>' +
        '</div>' +
        '<div class="subject-section-students">' + studentsHtml + '</div>' +
      '</div>';
  }

  // ------------------------------------------------------------------
  // localStorage
  // ------------------------------------------------------------------
  function saveState() {
    SGB.core.saveState(STORAGE_KEY, {
      students: students, seq: seq, activityType: activityType, sourceLabel: sourceLabel,
      byteLimit: getLimit(), resultsData: resultsData, savedAt: new Date().toISOString()
    });
  }

  function loadState() {
    var data = SGB.core.loadState(STORAGE_KEY);
    if (!data) return;
    if (Array.isArray(data.students)) { students = data.students; seq = data.seq || students.length; }
    if (data.activityType && PROFILES[data.activityType]) activityType = data.activityType;
    if (data.sourceLabel) sourceLabel = data.sourceLabel;
    applyProfileUI();
    if (data.byteLimit) byteLimitEl.value = data.byteLimit;
    renderCards();
    resultsData = data.resultsData || null;
    renderResults();
  }

  // ------------------------------------------------------------------
  // 이벤트 바인딩
  // ------------------------------------------------------------------
  activityTabsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.toggle-btn');
    if (!btn || !PROFILES[btn.dataset.type]) return;
    activityType = btn.dataset.type;
    applyProfileUI();
    saveState();
  });

  browseBtnEl.addEventListener('click', function (e) { e.stopPropagation(); fileInputEl.click(); });
  uploadZoneEl.addEventListener('click', function () { fileInputEl.click(); });
  uploadZoneEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputEl.click(); }
  });
  fileInputEl.addEventListener('change', function () {
    handleFiles(fileInputEl.files);
    fileInputEl.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    uploadZoneEl.addEventListener(evt, function (e) { e.preventDefault(); uploadZoneEl.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    uploadZoneEl.addEventListener(evt, function (e) { e.preventDefault(); uploadZoneEl.classList.remove('dragover'); });
  });
  uploadZoneEl.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFiles(files);
  });

  byteLimitEl.addEventListener('input', function () {
    students.forEach(function (s) { updateByteDisplay(s.id); });
    saveState();
  });

  addBtnEl.addEventListener('click', function () {
    setStudentsCollapsed(false); // 직접 추가로 작업 중일 땐 펼침 유지
    addStudent('', '', '');
  });
  clearBtnEl.addEventListener('click', function () {
    if (!window.confirm('학생자료와 점검 결과를 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    students = [];
    seq = 0;
    resultsData = null;
    setStudentsCollapsed(false);
    renderCards();
    renderResults();
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  });

  // 전체 점검하기(§P0) — 클릭 즉시 "분석 중…" 표시 후 다음 프레임에 실행해
  // 동기 분석으로 인한 UI 블록 이전에 버튼 상태 변경이 먼저 페인트되게 한다.
  analyzeBtnEl.addEventListener('click', function () {
    analyzeBtnEl.disabled = true;
    analyzeBtnEl.textContent = '분석 중…';
    requestAnimationFrame(function () {
      setTimeout(function () {
        analyzeAll();
        analyzeBtnEl.disabled = false;
        analyzeBtnEl.textContent = analyzeBtnDefaultLabel;
        scrollToResults();
      }, 0);
    });
  });

  onlyViolationsToggleEl.addEventListener('change', function () {
    onlyViolations = onlyViolationsToggleEl.checked;
    renderResults();
    saveUiState();
  });
  onlyIssuesToggleEl.addEventListener('change', function () {
    onlyWithIssues = onlyIssuesToggleEl.checked;
    renderResults();
    saveUiState();
  });

  resultsBodyEl.addEventListener('click', function (e) {
    var groupToggle = e.target.closest('[data-role="issue-group-toggle"]');
    if (!groupToggle) return;
    var body = document.getElementById(groupToggle.dataset.target);
    var expanded = groupToggle.getAttribute('aria-expanded') === 'true';
    groupToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (body) body.hidden = expanded;
  });

  exportSummaryBtnEl.addEventListener('click', function () {
    if (!resultsData || !resultsData.rows.length) { SGB.core.toast('먼저 점검을 실행하세요.'); return; }
    SGB.exporter.exportSummaryXlsx(resultsData.rows, {
      fileName: getProfile().exportName,
      columns: ['활동구분', '출처', '번호', '성명', '글자수', '바이트', '제한', '초과여부', '이슈수', '이슈상세']
    });
  });

  copyIssuesBtnEl.addEventListener('click', function () {
    if (!resultsData || !resultsData.students.length) { SGB.core.toast('먼저 점검을 실행하세요.'); return; }
    var lines = [];
    resultsData.students.forEach(function (st) {
      if (!st.issues.length) return;
      lines.push((st.no ? st.no + ' ' : '') + (st.name || '(이름 미입력)'));
      st.issues.forEach(function (iss) {
        lines.push('  [' + iss.tag + '] ' + (iss.quote ? '"' + iss.quote + '" — ' : '') + iss.note);
      });
    });
    var text = lines.length ? lines.join('\n') : '이슈가 발견되지 않았습니다.';
    SGB.exporter.copyIssues(text);
  });

  // ------------------------------------------------------------------
  // 초기화
  // ------------------------------------------------------------------
  applyProfileUI();
  renderCards();
  renderResults();
  loadState();
  onlyViolationsToggleEl.checked = onlyViolations;
  onlyIssuesToggleEl.checked = onlyWithIssues;
  updateStudentsToggleUI();
})();
