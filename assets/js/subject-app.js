/*
 * subject.html 페이지 컨트롤러 — DOM·이벤트·상태(localStorage `sgb_subject_v1`).
 * 렌더 책임 경계(§2b): 결과 화면 DOM 구성(.subject-section·토글·칩·학생 카드)은
 * 이 파일이 소유한다. checker-core는 byteLen/buildAnnotatedHtml/renderGauge 등
 * 유틸만 제공하고 페이지 DOM을 모른다. 규칙 판정은 SGB.rulesSubject.scan()에 위임.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'sgb_subject_v1';
  var UI_STATE_KEY = STORAGE_KEY + '_ui';
  var escapeHtml = SGB.core.escapeHtml;
  var escapeAttr = SGB.core.escapeHtml;

  // ------------------------------------------------------------------
  // 규칙코드(R1~R10·F1·F2·C/U/N/S/M 확장) → 표시용 서술형 한글 라벨.
  // 내부 코드(f.rule)는 그대로 유지(판정·테스트 불변) — 여기서 화면·내보내기용으로만 매핑.
  // ------------------------------------------------------------------
  var RULE_LABELS = {
    R1알파벳: '영문·외국어 표기',
    R2특수기호: '특수기호',
    R3과거시제: '과거형 표현',
    R4내면심리: '내면·심리 서술',
    R5역량어단독: '근거 없는 역량어',
    R6지칭어: '인물 지칭',
    R7기재금지: '기재불가 항목',
    R8무관내용: '성취기준 무관',
    R9줄바꿈도서명: '줄바꿈·따옴표 표기',
    R10분량: '분량 초과',
    F1외국어확인: '원어 표기 (확인 필요)',
    F2파일형식확인: '파일 형식 (확인 필요)',
    C1진로전공: '진로·전공 언급 (확인 필요)',
    C2학과직업: '학과·직업명 언급 (확인 필요)',
    U1대학명: '대학명 언급',
    U2기관인증: '교외 기관·인증시험 언급 (확인 필요)',
    U3부모직업: '부모 직업 암시 (기재불가)',
    N1기재유의어: '기재 유의어',
    N2괄호영문: '괄호 안 영문 표기',
    S1추측표현: '추측성 표현',
    S2미사여구: '미사여구',
    S3패턴반복: '문장 패턴 반복',
    S4템플릿반복: '상투적 템플릿 반복',
    S5종결혼용: '문장 종결 혼용',
    S6띄어쓰기: '띄어쓰기·표기 오류',
    S7과정부족: '과정·역할 서술 부족',
    S8문장중복: '문장 중복',
    M1성취기준코드: '성취기준 코드 직접 인용',
    M2수식기호: '수식 기호 직접 사용'
  };
  function ruleLabel(code) { return RULE_LABELS[code] || code; }

  // 텍스트영역 입력마다 전체 상태(localStorage) 직렬화가 도는 것을 막기 위한 디바운스.
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }
  var debouncedPersist = debounce(function () { persist(); }, 300);

  // ------------------------------------------------------------------
  // 상태
  // ------------------------------------------------------------------
  var students = []; // [{id, no, name, entries:[{subject, text}]}]
  var repairedSubjects = {}; // 잘림 과목명 → 정규형 (여러 파일 누적)
  var subjectOrder = []; // 정규형 과목 등장 순서(여러 파일 누적)
  var workbookCache = null;
  var workbookFileName = '';
  var lastResults = null; // computeResults() 캐시
  var currentView = 'subject'; // 'subject' | 'student'
  var activeFilter = null; // null = 전체, 아니면 과목명
  var gaugeQueue = []; // 결과 렌더 시 innerHTML 삽입 후 채울 게이지 목록

  // UI 표시 상태(데이터 아님) — 별도 키에 저장, 기존 STORAGE_KEY 상태 스키마는 건드리지 않는다.
  var uiState = SGB.core.loadState(UI_STATE_KEY) || {};
  var studentsCollapsed = !!uiState.cardsCollapsed;
  var onlyViolations = !!uiState.onlyViolations;
  var onlyWithIssues = !!uiState.onlyWithIssues;
  if (uiState.view === 'student' || uiState.view === 'subject') currentView = uiState.view;

  function saveUiState() {
    SGB.core.saveState(UI_STATE_KEY, {
      cardsCollapsed: studentsCollapsed,
      onlyViolations: onlyViolations,
      onlyWithIssues: onlyWithIssues,
      view: currentView
    });
  }

  // ------------------------------------------------------------------
  // DOM 참조
  // ------------------------------------------------------------------
  var fileInputEl = document.getElementById('fileInput');
  var uploadZoneEl = document.getElementById('uploadZone');
  var browseBtnEl = document.getElementById('browseBtn');
  var uploadStatusEl = document.getElementById('uploadStatus');
  var sheetRowEl = document.getElementById('sheetRow');
  var sheetSelectEl = document.getElementById('sheetSelect');
  var reloadBtnEl = document.getElementById('reloadBtn');
  var profileSelectEl = document.getElementById('profileSelect');
  var byteLimitEl = document.getElementById('byteLimit');
  var addBtnEl = document.getElementById('addBtn');
  var clearBtnEl = document.getElementById('clearBtn');
  var analyzeBtnEl = document.getElementById('analyzeBtn');
  var analyzeBtnDefaultLabel = analyzeBtnEl.textContent;
  var legendEl = document.getElementById('legend');
  var legendDetailsEl = document.getElementById('legendDetails');
  var cardsContainerEl = document.getElementById('cardsContainer');
  var studentsToggleEl = document.getElementById('studentsToggle');
  var studentsToggleLabelEl = document.getElementById('studentsToggleLabel');
  var resultsSectionEl = document.getElementById('resultsSection');
  var resultsHeadlineEl = document.getElementById('resultsHeadline');
  var resultsSummaryEl = document.getElementById('resultsSummary');
  var actionBarEl = document.getElementById('actionBar');
  var actionBarLabelEl = document.getElementById('actionBarLabel');
  var exportSummaryBtnEl = document.getElementById('exportSummaryBtn');
  var exportZipBtnEl = document.getElementById('exportZipBtn');
  var copyIssuesBtnEl = document.getElementById('copyIssuesBtn');
  var resultsControlsEl = document.getElementById('resultsControls');
  var viewToggleEl = document.getElementById('viewToggle');
  var subjectFiltersEl = document.getElementById('subjectFilters');
  var onlyViolationsToggleEl = document.getElementById('onlyViolationsToggle');
  var onlyIssuesToggleEl = document.getElementById('onlyIssuesToggle');
  var resultsBodyEl = document.getElementById('resultsBody');
  var emptyStateEl = document.getElementById('emptyState');

  function getProfileId() { return profileSelectEl.value; }
  function getByteLimit() { return Number(byteLimitEl.value) || 1500; }
  function findStudent(id) { return students.filter(function (s) { return s.id === id; })[0]; }
  function nextId() { return students.reduce(function (m, s) { return Math.max(m, s.id); }, 0) + 1; }

  // ------------------------------------------------------------------
  // 범례
  // ------------------------------------------------------------------
  // 색 = rules-subject.js 실제 채점 색과 일치(S8=m-teal, S5·S6=m-slate 등).
  // 스와치는 career-app.js와 동일하게 m-* 클래스 재사용(인라인 style 대신).
  var LEGEND = [
    ['위반 — 줄바꿈·특수기호·과거형·기재금지 등', 'm-red'],
    ['확인 필요 — 외국어·파일형식·지칭어 등 교사 판단', 'm-brown'],
    ['내면심리·역량어단독·추측 표현', 'm-rose'],
    ['미사여구 남발', 'm-amber'],
    ['패턴·템플릿 반복', 'm-violet'],
    ['문장 중복', 'm-teal'],
    ['종결혼용·띄어쓰기', 'm-slate']
  ];
  function renderLegend() {
    legendEl.innerHTML = LEGEND.map(function (row) {
      return '<span class="legend-item"><span class="legend-swatch ' + row[1] + '"></span>' + escapeHtml(row[0]) + '</span>';
    }).join('');
  }

  // ------------------------------------------------------------------
  // 학생자료 편집 영역 접기/펼치기(§P1) — 업로드로 채워지면 자동 접힘,
  // 직접 추가로 작업 중일 땐 펼침 유지. 접힘 상태는 UI_STATE_KEY에 보존.
  // ------------------------------------------------------------------
  function updateStudentsToggleUI() {
    studentsToggleEl.setAttribute('aria-expanded', studentsCollapsed ? 'false' : 'true');
    cardsContainerEl.hidden = studentsCollapsed;
    studentsToggleLabelEl.textContent = studentsCollapsed
      ? ('학생자료 ' + students.length + '명 — 펼쳐서 수정')
      : '학생자료';
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

  // ------------------------------------------------------------------
  // 학생자료 편집(다중 과목 entry)
  // ------------------------------------------------------------------
  function addStudent(no, name) {
    students.push({ id: nextId(), no: no || '', name: name || '', entries: [{ subject: '', text: '' }] });
    renderCards();
    persist();
  }
  function removeStudent(id) {
    students = students.filter(function (s) { return s.id !== id; });
    renderCards();
    persist();
  }
  function addEntry(studentId) {
    var st = findStudent(studentId);
    if (!st) return;
    st.entries.push({ subject: '', text: '' });
    renderCards();
    persist();
  }
  function removeEntry(studentId, entryIdx) {
    var st = findStudent(studentId);
    if (!st) return;
    st.entries.splice(entryIdx, 1);
    if (!st.entries.length) st.entries.push({ subject: '', text: '' });
    renderCards();
    persist();
  }

  function renderCards() {
    if (!students.length) {
      cardsContainerEl.innerHTML = '<div class="empty-state"><p>아직 학생이 없습니다. 위에서 엑셀을 불러오거나 "+ 학생 직접 추가"를 눌러주세요.</p></div>';
      updateStudentsToggleUI();
      return;
    }
    cardsContainerEl.innerHTML = students.map(function (st) {
      var entriesHtml = st.entries.map(function (e, idx) {
        var gaugeId = 'edit-gauge-' + st.id + '-' + idx;
        var removeBtn = st.entries.length > 1
          ? '<button type="button" class="entry-row__remove" data-role="remove-entry" data-id="' + st.id + '" data-idx="' + idx + '">과목 삭제</button>'
          : '';
        return '' +
          '<div class="entry-row">' +
            '<div class="entry-row__head">' +
              '<input type="text" class="entry-row__subject" placeholder="과목명" value="' + escapeAttr(e.subject) + '" data-role="subject" data-id="' + st.id + '" data-idx="' + idx + '">' +
              removeBtn +
            '</div>' +
            '<textarea placeholder="세특 내용을 붙여넣으세요." data-role="text" data-id="' + st.id + '" data-idx="' + idx + '">' + escapeHtml(e.text) + '</textarea>' +
            '<div class="entry-row__meta">' +
              '<div class="gauge" id="' + gaugeId + '"></div>' +
              '<span class="entry-row__count" data-role="count" data-id="' + st.id + '" data-idx="' + idx + '"></span>' +
            '</div>' +
          '</div>';
      }).join('');
      return '' +
        '<div class="card student-edit-card" data-id="' + st.id + '">' +
          '<div class="student-edit-card__head">' +
            '<input type="text" class="student-edit-card__no" placeholder="번호" value="' + escapeAttr(st.no) + '" data-role="no" data-id="' + st.id + '">' +
            '<input type="text" class="student-edit-card__name" placeholder="성명" value="' + escapeAttr(st.name) + '" data-role="name" data-id="' + st.id + '">' +
            '<button type="button" class="student-edit-card__remove" data-role="remove-student" data-id="' + st.id + '">학생 삭제</button>' +
          '</div>' +
          entriesHtml +
          '<button type="button" class="btn btn-ghost entry-add-btn" data-role="add-entry" data-id="' + st.id + '">+ 과목 추가</button>' +
        '</div>';
    }).join('');

    students.forEach(function (st) {
      st.entries.forEach(function (e, idx) { updateEntryByteDisplay(st.id, idx); });
    });
    updateStudentsToggleUI();
  }

  function updateEntryByteDisplay(studentId, idx) {
    var st = findStudent(studentId);
    if (!st || !st.entries[idx]) return;
    var text = st.entries[idx].text || '';
    var limit = getByteLimit();
    var bytes = SGB.core.byteLen(text, 'utf3');
    var chars = SGB.core.charLen(text);
    var gaugeEl = document.getElementById('edit-gauge-' + studentId + '-' + idx);
    if (gaugeEl) SGB.core.renderGauge(gaugeEl, chars, bytes, limit);
    var countEl = cardsContainerEl.querySelector('[data-role="count"][data-id="' + studentId + '"][data-idx="' + idx + '"]');
    if (countEl) {
      countEl.textContent = chars + '자 · ' + bytes + ' / ' + limit + 'B';
      countEl.classList.toggle('over', bytes > limit);
    }
  }

  cardsContainerEl.addEventListener('input', function (e) {
    var role = e.target.dataset.role;
    if (!role) return;
    var id = Number(e.target.dataset.id);
    var st = findStudent(id);
    if (!st) return;
    if (role === 'no') { st.no = e.target.value; persist(); return; }
    if (role === 'name') { st.name = e.target.value; persist(); return; }
    if (role === 'subject') {
      var sIdx = Number(e.target.dataset.idx);
      if (st.entries[sIdx]) st.entries[sIdx].subject = e.target.value;
      persist();
      return;
    }
    if (role === 'text') {
      var tIdx = Number(e.target.dataset.idx);
      if (st.entries[tIdx]) st.entries[tIdx].text = e.target.value;
      updateEntryByteDisplay(id, tIdx);
      debouncedPersist(); // 텍스트영역은 키 입력마다 전체 상태 저장이 돌지 않도록 300ms 디바운스
    }
  });
  cardsContainerEl.addEventListener('click', function (e) {
    var removeStudentBtn = e.target.closest('[data-role="remove-student"]');
    if (removeStudentBtn) { removeStudent(Number(removeStudentBtn.dataset.id)); return; }
    var addEntryBtn = e.target.closest('[data-role="add-entry"]');
    if (addEntryBtn) { addEntry(Number(addEntryBtn.dataset.id)); return; }
    var removeEntryBtn = e.target.closest('[data-role="remove-entry"]');
    if (removeEntryBtn) { removeEntry(Number(removeEntryBtn.dataset.id), Number(removeEntryBtn.dataset.idx)); }
  });

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

  function applyParsedResult(parsedList, statusPrefix) {
    var merged = students.slice();
    var mergedRepaired = {};
    Object.keys(repairedSubjects).forEach(function (k) { mergedRepaired[k] = repairedSubjects[k]; });
    var newSubjects = [];
    var totalReplaced = 0;
    parsedList.forEach(function (result) {
      merged = SGB.parse.mergeStudents(merged, result.students);
      totalReplaced += merged.replacedCount || 0;
      Object.keys(result.repairedSubjects || {}).forEach(function (k) { mergedRepaired[k] = result.repairedSubjects[k]; });
      (result.subjects || []).forEach(function (s) { if (newSubjects.indexOf(s) === -1) newSubjects.push(s); });
    });
    students = merged;
    repairedSubjects = mergedRepaired;
    newSubjects.forEach(function (s) { if (subjectOrder.indexOf(s) === -1) subjectOrder.push(s); });

    renderCards();
    uploadStatusEl.textContent = statusPrefix + ' · 학생 ' + students.length + '명 불러오기 완료';
    uploadStatusEl.classList.add('ok');
    uploadStatusEl.classList.remove('err');
    if (totalReplaced > 0) SGB.core.toast('중복 과목 파일 감지 — 최신 내용으로 교체됨 (' + totalReplaced + '건)');
    setStudentsCollapsed(true); // 업로드로 학생자료가 채워지면 편집 목록은 자동으로 접는다
    analyzeAll();
    persist();
    scrollToResults();
  }

  function importFromWorkbook(workbook, fileName, sheetName) {
    var result = SGB.parse.parseWorkbook(workbook, { fileName: fileName, sheetName: sheetName });
    var formatLabel = result.format === 'printdump' ? '인쇄덤프 형식' : '표준 형식';
    applyParsedResult([result], fileName + ' · ' + formatLabel);
  }

  function importMultipleFiles(files) {
    var reads = files.map(function (f) { return readWorkbookFile(f).catch(function () { return null; }); });
    Promise.all(reads).then(function (results) {
      var valid = results.filter(Boolean);
      if (!valid.length) {
        uploadStatusEl.textContent = '파일을 읽지 못했습니다.';
        uploadStatusEl.classList.add('err');
        uploadStatusEl.classList.remove('ok');
        return;
      }
      var parsedList = valid.map(function (r) { return SGB.parse.parseWorkbook(r.workbook, { fileName: r.name }); });
      var failedCount = results.length - valid.length;
      var prefix = '파일 ' + valid.length + '개' + (failedCount ? ' (' + failedCount + '개 읽기 실패)' : '');
      applyParsedResult(parsedList, prefix);
    });
  }

  function handleFiles(files) {
    uploadStatusEl.textContent = '';
    uploadStatusEl.className = 'upload-status';
    if (files.length === 1) {
      readWorkbookFile(files[0]).then(function (res) {
        workbookCache = res.workbook;
        workbookFileName = res.name;
        var names = res.workbook.SheetNames;
        if (names.length > 1) {
          sheetSelectEl.innerHTML = names.map(function (n) { return '<option value="' + escapeAttr(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
          sheetRowEl.hidden = false;
        } else {
          sheetRowEl.hidden = true;
        }
        importFromWorkbook(res.workbook, res.name, sheetSelectEl.value || undefined);
      }).catch(function () {
        uploadStatusEl.textContent = '파일을 읽는 중 오류가 발생했습니다. 엑셀(.xlsx) 파일인지 확인해주세요.';
        uploadStatusEl.classList.add('err');
      });
    } else {
      sheetRowEl.hidden = true;
      importMultipleFiles(files);
    }
  }

  browseBtnEl.addEventListener('click', function (e) { e.stopPropagation(); fileInputEl.click(); });
  uploadZoneEl.addEventListener('click', function () { fileInputEl.click(); });
  uploadZoneEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputEl.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    uploadZoneEl.addEventListener(evt, function (e) { e.preventDefault(); uploadZoneEl.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    uploadZoneEl.addEventListener(evt, function (e) { e.preventDefault(); uploadZoneEl.classList.remove('dragover'); });
  });
  uploadZoneEl.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (files.length) handleFiles(files);
  });
  fileInputEl.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileInputEl.files || []);
    if (files.length) handleFiles(files);
  });
  sheetSelectEl.addEventListener('change', function () {
    if (workbookCache) importFromWorkbook(workbookCache, workbookFileName, sheetSelectEl.value);
  });
  reloadBtnEl.addEventListener('click', function () {
    if (workbookCache) importFromWorkbook(workbookCache, workbookFileName, sheetSelectEl.value || undefined);
  });

  // ------------------------------------------------------------------
  // 점검 실행 — SGB.rulesSubject.scan() 위임, 과목별로 묶어 교차중복도 계산
  // ------------------------------------------------------------------
  function isRepairedSubject(subject) {
    return Object.keys(repairedSubjects).some(function (k) { return repairedSubjects[k] === subject; });
  }

  function computeResults() {
    var profileId = getProfileId();
    var byteLimit = getByteLimit();
    var bySubjectMap = {};
    students.forEach(function (st) {
      (st.entries || []).forEach(function (e) {
        if (!e.subject && !e.text) return;
        var subj = e.subject || '(과목 미지정)';
        if (!bySubjectMap[subj]) bySubjectMap[subj] = [];
        bySubjectMap[subj].push({ student: st, entry: e });
      });
    });

    var order = subjectOrder.filter(function (s) { return bySubjectMap[s]; });
    Object.keys(bySubjectMap).forEach(function (s) { if (order.indexOf(s) === -1) order.push(s); });

    var groups = order.map(function (subj) {
      var items = bySubjectMap[subj];
      var dupInput = items.map(function (it, i) { return { id: i, text: it.entry.text || '' }; });
      var dupMap = SGB.rulesSubject.findCrossDuplicates(dupInput);
      var rows = items.map(function (it, i) {
        var text = it.entry.text || '';
        var findings = SGB.rulesSubject.scan(text, { id: profileId, subjectName: subj, byteLimit: byteLimit });
        findings = findings.concat(dupMap[i] || []);
        var bytes = SGB.core.byteLen(text, 'utf3');
        var chars = SGB.core.charLen(text);
        return { student: it.student, entry: it.entry, text: text, findings: findings, bytes: bytes, chars: chars, over: bytes > byteLimit };
      });
      return { subject: subj, rows: rows, repaired: isRepairedSubject(subj) };
    });

    return { groups: groups, profileId: profileId, byteLimit: byteLimit };
  }

  function analyzeAll() {
    lastResults = computeResults();
    if (activeFilter && !lastResults.groups.some(function (g) { return g.subject === activeFilter; })) {
      activeFilter = null;
    }
    renderResults();
    persist();
  }

  // ------------------------------------------------------------------
  // 결과 렌더
  // ------------------------------------------------------------------
  function statHtml(value, label) {
    return '<div class="stat"><span class="stat-value">' + value + '</span><span class="stat-label">' + escapeHtml(label) + '</span></div>';
  }

  // 확정 위반만 보기(§P1) — grade==='violation'만 남긴다. 바이트 초과는 findings가 아니라
  // r.over 별도 플래그라 이 필터 대상이 아니다(항상 표시 — 명백한 초과라 숨길 이유가 없음).
  function filteredFindingsOf(r) {
    return onlyViolations ? r.findings.filter(function (f) { return f.grade === 'violation'; }) : r.findings;
  }
  function rowVisibleCount(r) {
    return filteredFindingsOf(r).length + (r.over ? 1 : 0);
  }

  function issueItemHtml(it) {
    return '<div class="issue-item"><span class="issue-tag ' + escapeAttr(it.color) + '">' + escapeHtml(it.tag) + '</span>' +
      '<span class="issue-item__note">' + (it.quote ? '"' + escapeHtml(it.quote) + '" — ' : '') + escapeHtml(it.note || '') + '</span></div>';
  }

  // 같은 규칙(태그)의 다수 발생을 1행으로 접어서 목록 밀도를 낮춘다(§P1).
  // 하이라이트 mark는 그대로 유지되고(별도 buildAnnotatedHtml 경로), 여기서는 목록만 압축.
  function buildIssuesHtml(r, findings) {
    var items = [];
    if (r.over) {
      items.push({ tag: '바이트 초과', color: 'm-red', note: r.chars + '자 · ' + r.bytes + '/' + getByteLimit() + '바이트', quote: '' });
    }
    findings.forEach(function (f) {
      var quote = f.quote || '';
      var excerpt = quote.length > 40 ? quote.slice(0, 40) + '…' : quote;
      items.push({ tag: ruleLabel(f.rule), color: f.color || 'm-slate', note: f.note || '', quote: excerpt });
    });
    if (!items.length) return '<p class="issue-clean">발견된 문제 표현 없음</p>';

    var groups = SGB.core.groupBy(items, function (it) { return it.tag; });
    var html = groups.map(function (g, gi) {
      if (g.items.length === 1) return issueItemHtml(g.items[0]);
      var first = g.items[0];
      var uid = 'ig-' + Math.random().toString(36).slice(2, 8) + '-' + gi;
      return '' +
        '<div class="issue-group">' +
          '<button type="button" class="issue-item issue-group__toggle" data-role="issue-group-toggle" data-target="' + uid + '" aria-expanded="false">' +
            '<span class="issue-tag ' + escapeAttr(first.color) + '">' + escapeHtml(first.tag) + '</span>' +
            '<span class="issue-item__note">' + (first.quote ? '\'' + escapeHtml(first.quote) + '\' 외 ' : '') + (g.items.length - 1) + '건</span>' +
            '<svg class="issue-group__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9 L12 15 L18 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="issue-group__body" id="' + uid + '" hidden>' + g.items.map(issueItemHtml).join('') + '</div>' +
        '</div>';
    }).join('');
    return '<div class="issue-list">' + html + '</div>';
  }

  function renderStudentResultCard(r) {
    var findings = filteredFindingsOf(r);
    var annotated = SGB.core.buildAnnotatedHtml(r.text, findings);
    var byteLimit = getByteLimit();
    var gaugeId = 'result-gauge-' + (gaugeQueue.length + 1) + '-' + Math.random().toString(36).slice(2, 7);
    gaugeQueue.push({ id: gaugeId, chars: r.chars, bytes: r.bytes, limit: byteLimit });
    return '' +
      '<article class="student-card">' +
        '<div class="student-card__header">' +
          '<div><span class="student-card__name">' + escapeHtml(r.student.name || '(이름 미입력)') + '</span>' +
            '<span class="student-card__no">' + escapeHtml(r.student.no || '') + '</span></div>' +
          '<div class="student-card__gauge-wrap">' +
            '<div class="gauge" id="' + gaugeId + '"></div>' +
            '<span class="student-card__gauge-label">' + r.chars + '자 · ' + r.bytes + '/' + byteLimit + 'B</span>' +
          '</div>' +
        '</div>' +
        '<div class="annotated">' + (annotated || '<span style="color:var(--ink-soft);">내용 없음</span>') + '</div>' +
        buildIssuesHtml(r, findings) +
      '</article>';
  }

  function issueCountOf(rows) {
    return rows.reduce(function (s, r) { return s + rowVisibleCount(r); }, 0);
  }

  function renderSubjectView(groups) {
    var visible = activeFilter ? groups.filter(function (g) { return g.subject === activeFilter; }) : groups;
    if (!visible.length) return '';
    return visible.map(function (g) {
      var repairedBadge = g.repaired ? '<span class="badge">표기 보정됨</span>' : '';
      var shownRows = onlyWithIssues ? g.rows.filter(function (r) { return rowVisibleCount(r) > 0; }) : g.rows;
      var countBadge = (onlyWithIssues && shownRows.length !== g.rows.length)
        ? (shownRows.length + '/' + g.rows.length + '명 표시')
        : (g.rows.length + '명');
      var studentsHtml = shownRows.map(renderStudentResultCard).join('');
      return '' +
        '<section class="subject-section" data-subject="' + escapeAttr(g.subject) + '">' +
          '<div class="subject-section-header">' +
            '<div><h2>' + escapeHtml(g.subject) + '</h2>' + repairedBadge +
              '<span class="badge">' + escapeHtml(countBadge) + '</span>' +
              '<span class="badge">이슈 ' + issueCountOf(g.rows) + '건</span></div>' +
            '<div class="subject-section-header__actions">' +
              '<button type="button" class="btn btn-ghost" data-export-subject="' + escapeAttr(g.subject) + '">' + escapeHtml(g.subject) + '_점검결과.xlsx</button>' +
            '</div>' +
          '</div>' +
          '<div class="subject-section-students">' + studentsHtml + '</div>' +
        '</section>';
    }).join('');
  }

  function renderStudentView(groups) {
    var visibleGroups = activeFilter ? groups.filter(function (g) { return g.subject === activeFilter; }) : groups;
    var byStudent = {};
    visibleGroups.forEach(function (g) {
      g.rows.forEach(function (r) {
        if (onlyWithIssues && rowVisibleCount(r) === 0) return;
        var key = r.student.id;
        if (!byStudent[key]) byStudent[key] = { student: r.student, items: [] };
        byStudent[key].items.push({ subject: g.subject, row: r });
      });
    });
    var blocks = students.map(function (st) { return byStudent[st.id]; }).filter(Boolean);
    if (!blocks.length) return '';
    return blocks.map(function (blk) {
      var subjectsHtml = blk.items.map(function (it) {
        return '<div><p class="student-view-block__subject-label">' + escapeHtml(it.subject) + '</p>' + renderStudentResultCard(it.row) + '</div>';
      }).join('');
      return '' +
        '<section class="student-view-block">' +
          '<div class="student-view-block__head"><h3>' + escapeHtml(blk.student.name || '(이름 미입력)') + '</h3>' +
            '<span class="badge">' + escapeHtml(blk.student.no || '') + '</span></div>' +
          '<div class="student-view-block__subjects">' + subjectsHtml + '</div>' +
        '</section>';
    }).join('');
  }

  function renderFilterChips(groups) {
    var chips = ['<button type="button" class="chip' + (!activeFilter ? ' active' : '') + '" data-filter="">전체</button>'];
    groups.forEach(function (g) {
      chips.push('<button type="button" class="chip' + (activeFilter === g.subject ? ' active' : '') + '" data-filter="' + escapeAttr(g.subject) + '">' + escapeHtml(g.subject) + '</button>');
    });
    subjectFiltersEl.innerHTML = chips.join('');
  }

  function renderResults() {
    if (!lastResults || !lastResults.groups.length) {
      resultsBodyEl.innerHTML = '';
      resultsSummaryEl.innerHTML = '';
      subjectFiltersEl.innerHTML = '';
      resultsHeadlineEl.hidden = true;
      // 학생이 아예 없으면 편집 영역의 빈 메시지와 중복되므로 결과 빈 상태는 숨긴다(§P2 단일 빈상태).
      // 학생은 있지만 분석 결과가 비어 있는 경우에만 결과 영역의 통합 빈 상태를 보여준다.
      emptyStateEl.hidden = students.length === 0;
      actionBarEl.hidden = true;
      resultsControlsEl.hidden = true;
      legendDetailsEl.hidden = true;
      return;
    }

    var studentIds = {};
    var totalIssues = 0, overCount = 0;
    lastResults.groups.forEach(function (g) {
      g.rows.forEach(function (r) {
        studentIds[r.student.id] = true;
        totalIssues += r.findings.length + (r.over ? 1 : 0);
        if (r.over) overCount += 1;
      });
    });

    emptyStateEl.hidden = true;
    actionBarEl.hidden = false;
    resultsControlsEl.hidden = false;
    legendDetailsEl.hidden = false;

    var studentCount = Object.keys(studentIds).length;
    resultsHeadlineEl.hidden = false;
    resultsHeadlineEl.textContent = '학생 ' + studentCount + '명 · 이슈 ' + totalIssues + '건 발견';

    resultsSummaryEl.classList.add('stats-row');
    resultsSummaryEl.innerHTML =
      statHtml(studentCount, '학생') +
      statHtml(lastResults.groups.length, '과목') +
      statHtml(totalIssues, '이슈') +
      statHtml(overCount, '바이트 초과');
    actionBarLabelEl.textContent = studentCount + '명 · 이슈 ' + totalIssues + '건';

    renderFilterChips(lastResults.groups);

    gaugeQueue = [];
    resultsBodyEl.innerHTML = currentView === 'subject' ? renderSubjectView(lastResults.groups) : renderStudentView(lastResults.groups);
    gaugeQueue.forEach(function (g) {
      var el = document.getElementById(g.id);
      if (el) SGB.core.renderGauge(el, g.chars, g.bytes, g.limit);
    });
  }

  viewToggleEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    currentView = btn.dataset.view;
    viewToggleEl.querySelectorAll('.toggle-btn').forEach(function (b) {
      var active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderResults();
    saveUiState();
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

  resultsSectionEl.addEventListener('click', function (e) {
    var groupToggle = e.target.closest('[data-role="issue-group-toggle"]');
    if (groupToggle) {
      var body = document.getElementById(groupToggle.dataset.target);
      var expanded = groupToggle.getAttribute('aria-expanded') === 'true';
      groupToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (body) body.hidden = expanded;
      return;
    }
    var filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      activeFilter = filterBtn.dataset.filter || null;
      renderResults();
      return;
    }
    var exportBtn = e.target.closest('[data-export-subject]');
    if (exportBtn && lastResults) {
      var subj = exportBtn.dataset.exportSubject;
      var group = lastResults.groups.filter(function (g) { return g.subject === subj; })[0];
      if (group) SGB.exporter.exportSubjectXlsx(subj, group.rows.map(function (r) { return rowToExportRecord(r, subj); }));
    }
  });

  // ------------------------------------------------------------------
  // 내보내기 3종
  // ------------------------------------------------------------------
  function rowToExportRecord(r, subject) {
    var issuesText = r.findings.map(function (f) {
      return '[' + ruleLabel(f.rule) + '] ' + (f.quote ? '"' + f.quote + '" ' : '') + '- ' + (f.note || '');
    }).join(' | ');
    if (r.over) issuesText = ('바이트 초과 (' + r.chars + '자, ' + r.bytes + '/' + getByteLimit() + ')') + (issuesText ? ' | ' + issuesText : '');
    return {
      과목: subject || (r.entry && r.entry.subject) || '',
      번호: r.student.no || '',
      성명: r.student.name || '',
      글자수: r.chars,
      바이트: r.bytes,
      제한: getByteLimit(),
      초과여부: r.over ? 'Y' : '',
      이슈수: r.findings.length + (r.over ? 1 : 0),
      이슈상세: issuesText
    };
  }

  exportSummaryBtnEl.addEventListener('click', function () {
    if (!lastResults) return;
    var rows = [];
    lastResults.groups.forEach(function (g) {
      g.rows.forEach(function (r) { rows.push(rowToExportRecord(r, g.subject)); });
    });
    SGB.exporter.exportSummaryXlsx(rows, { fileName: '과목세특_점검결과_전체.xlsx' });
  });

  exportZipBtnEl.addEventListener('click', function () {
    if (!lastResults) return;
    var groups = lastResults.groups.map(function (g) {
      return { subject: g.subject, rows: g.rows.map(function (r) { return rowToExportRecord(r, g.subject); }) };
    });
    SGB.exporter.exportAllSubjectsZip(groups, { fileName: 'saenggibu_과목별점검_전체.zip' });
  });

  function appendRowLines(lines, r, indent) {
    indent = indent || '';
    var name = (r.student.no ? r.student.no + ' ' : '') + (r.student.name || '(이름 미입력)');
    var issueCount = r.findings.length + (r.over ? 1 : 0);
    if (!issueCount) {
      lines.push(indent + '- ' + name + ': 이슈 없음');
      return;
    }
    lines.push(indent + '- ' + name + ' (' + issueCount + '건)');
    if (r.over) lines.push(indent + '  · 바이트 초과: ' + r.chars + '자/' + r.bytes + 'B');
    r.findings.forEach(function (f) {
      lines.push(indent + '  · [' + ruleLabel(f.rule) + '] ' + (f.quote ? '"' + f.quote + '" ' : '') + '- ' + (f.note || ''));
    });
  }

  copyIssuesBtnEl.addEventListener('click', function () {
    if (!lastResults) return;
    var lines = [];
    var groups = activeFilter ? lastResults.groups.filter(function (g) { return g.subject === activeFilter; }) : lastResults.groups;
    if (currentView === 'subject') {
      groups.forEach(function (g) {
        lines.push('■ ' + g.subject);
        g.rows.forEach(function (r) { appendRowLines(lines, r); });
      });
    } else {
      var byStudent = {};
      groups.forEach(function (g) {
        g.rows.forEach(function (r) {
          var key = r.student.id;
          if (!byStudent[key]) byStudent[key] = { student: r.student, items: [] };
          byStudent[key].items.push({ subject: g.subject, row: r });
        });
      });
      students.forEach(function (st) {
        var blk = byStudent[st.id];
        if (!blk) return;
        lines.push('■ ' + (st.no ? st.no + ' ' : '') + (st.name || '(이름 미입력)'));
        blk.items.forEach(function (it) {
          lines.push('  [' + it.subject + ']');
          appendRowLines(lines, it.row, '  ');
        });
      });
    }
    SGB.exporter.copyIssues(lines.join('\n'));
  });

  // ------------------------------------------------------------------
  // localStorage
  // ------------------------------------------------------------------
  function persist() {
    SGB.core.saveState(STORAGE_KEY, {
      students: students,
      profileId: getProfileId(),
      byteLimit: getByteLimit(),
      repairedSubjects: repairedSubjects,
      subjectOrder: subjectOrder,
      savedAt: new Date().toISOString()
    });
  }

  function restore() {
    var data = SGB.core.loadState(STORAGE_KEY);
    if (!data) return;
    if (Array.isArray(data.students)) students = data.students;
    if (data.profileId) profileSelectEl.value = data.profileId;
    if (data.byteLimit) byteLimitEl.value = data.byteLimit;
    repairedSubjects = data.repairedSubjects || {};
    subjectOrder = data.subjectOrder || [];
    renderCards();
    if (students.length) analyzeAll();
  }

  // ------------------------------------------------------------------
  // 나머지 이벤트 배선 + 초기화
  // ------------------------------------------------------------------
  byteLimitEl.addEventListener('input', function () {
    students.forEach(function (st) { st.entries.forEach(function (e, idx) { updateEntryByteDisplay(st.id, idx); }); });
    if (lastResults) analyzeAll(); else persist();
  });
  profileSelectEl.addEventListener('change', function () {
    if (lastResults) analyzeAll(); else persist();
  });
  addBtnEl.addEventListener('click', function () {
    setStudentsCollapsed(false); // 직접 추가로 작업 중일 땐 펼침 유지
    addStudent('', '');
  });
  clearBtnEl.addEventListener('click', function () {
    if (!window.confirm('학생자료와 점검 결과를 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    students = [];
    repairedSubjects = {};
    subjectOrder = [];
    lastResults = null;
    activeFilter = null;
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

  renderLegend();
  renderCards();
  restore();
  onlyViolationsToggleEl.checked = onlyViolations;
  onlyIssuesToggleEl.checked = onlyWithIssues;
  viewToggleEl.querySelectorAll('.toggle-btn').forEach(function (b) {
    var active = b.dataset.view === currentView;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  updateStudentsToggleUI();
})();
