/*
 * 집중 모드 컨트롤러.
 *
 * 파일 캡처: 수정본 xlsx 를 만들려면 원본 워크북 바이트가 필요한데, 별도
 * 페이지로 넘기면 교사가 파일을 다시 올려야 한다. 그래서 같은 페이지의
 * 파일 input 을 독립적으로 한 번 더 구독해 자기 사본을 갖는다.
 *
 * 로드 순서 주의: career-app.js 는 change 핸들러 끝에서 input 을 비우므로
 * 이 스크립트가 반드시 먼저 로드돼야 files 를 볼 수 있다.
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  // 진로활동 "묶음" 형식 감지 — career-app.js:347 isCareerBundleFormat과 완전히 같은
  // 조건(첫 8행 안에 진로활동+학생부가 함께 나오는 줄)이다.
  //
  // 이 형식은 career-app.js가 고정 열(0=번호, 1=성명, 3=특기사항, 4=희망분야 값)과
  // "희망분야" 라벨 특례로 직접 파싱해 화면에 보여준다. SGB.writeback은 이 전용
  // 파서를 전혀 모르고 xlsx-parse.js 의 일반 열 탐지(findColumnIndices)로 같은
  // 파일을 다시 훑는데, 그 결과 희망분야 열(4번)의 실제 값이 통째로 빠지고 "희망분야"
  // 라벨 글자만 본문에 남는 것을 fixtures/career-bundle.xlsx로 확인했다(Task 9 조사) —
  // 즉 집중 모드가 보여주는 문장과 실제로 셀에 쓰일 문장이 달라질 수 있다. 그래서
  // 이 형식은 화면에 경고(blockReason/unreliable)를 붙이고 수정본 내려받기·고친
  // 문장 복사를 막는다(Finding 3).
  //
  // DOM 에 의존하지 않는 순수 함수라 아래 document 가드보다 앞에 두고 노출한다 —
  // career-app.js의 isCareerBundleFormat과 실제로 같은 판정을 내리는지 Node
  // 테스트(tests/writeback.test.js)에서 대조하기 위함이다(Finding 8).
  function isCareerBundleWorkbook(workbook) {
    try {
      var XLSX = g.XLSX;
      var ws = workbook.Sheets[workbook.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      for (var r = 0; r < Math.min(rows.length, 8); r++) {
        var line = (rows[r] || []).map(function (c) { return (c == null ? '' : String(c)); }).join(' ');
        if (/진로\s*활동/.test(line) && /학생부/.test(line)) return true;
      }
    } catch (e) { /* 읽기 실패는 이후 plan() 이 다시 처리한다 */ }
    return false;
  }
  g.SGB.workApp = g.SGB.workApp || {};
  g.SGB.workApp.isCareerBundleWorkbook = isCareerBundleWorkbook;

  if (typeof document === 'undefined') return;

  var files = [];   // [{name, buffer, workbook}]
  var filesGen = 0; // captureFiles 세대 카운터 — 재선택 중 이전 FileReader 결과가 섞이지 않게 한다(Finding 7)
  var overlay = null;

  function captureFiles(fileList) {
    var list = Array.prototype.slice.call(fileList || []);
    if (!list.length) return;
    filesGen++;
    var gen = filesGen;
    var local = []; // 이 세대만의 결과를 따로 쌓는다 — 이전 세대의 files 를 직접 건드리지 않는다
    list.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function (e) {
        // 이 콜백이 도착하기 전에 사용자가 파일을 다시 선택했다면(새 gen 발급)
        // 이 결과는 낡은 세대의 것이니 버린다 — 안 그러면 두 선택의 파일이 섞인다.
        if (gen !== filesGen) return;
        try {
          var buf = e.target.result;
          local.push({
            name: f.name,
            buffer: buf,
            workbook: g.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false })
          });
          files = local; // 이 세대 파일만 담긴 배열로 교체 — 부분 완료 중에도 항상 일관된 스냅샷
        } catch (err) { /* 읽기 실패한 파일은 건너뛴다 — 기존 앱이 오류를 표시한다 */ }
      };
      reader.readAsArrayBuffer(f);
    });
  }

  function wireCapture() {
    var input = document.getElementById('fileInput');
    var zone = document.getElementById('uploadZone');
    if (input) input.addEventListener('change', function () { captureFiles(input.files); });
    if (zone) {
      zone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) captureFiles(e.dataTransfer.files);
      });
    }
  }

  var items = [];     // 작업 단위 목록
  var current = 0;

  function scanOf(text, subject) {
    if (g.SGB.rulesSubject) {
      var sel = document.getElementById('profileSelect');
      var lim = document.getElementById('byteLimit');
      return g.SGB.rulesSubject.scan(text, {
        id: sel ? sel.value : 'general',
        subjectName: subject || '',
        byteLimit: lim ? Number(lim.value) || 1500 : 1500
      });
    }
    var tab = document.querySelector('#activityTabs .toggle-btn.active');
    var prof = g.SGB.rulesCareer.PROFILES[tab ? tab.dataset.type : 'club'];
    return g.SGB.rulesCareer.scan(text, prof);
  }

  // 창체(career.html)의 현재 활동유형 탭. #activityTabs 가 없는 교과 페이지에서는
  // 빈 문자열을 돌려주고 호출 쪽(mkItem)이 그 경우 과목을 그대로 쓴다.
  function activeTabType() {
    var tab = document.querySelector('#activityTabs .toggle-btn.active');
    return tab ? tab.dataset.type : '';
  }

  // worklist 저장 시 함께 담을 제안 신원(Finding 2). span 은 얕은 복사해 이후
  // suggestions 배열이 바뀌어도 저장된 값이 딸려 바뀌지 않게 한다.
  function suggMeta(s) {
    return { rule: s.rule, span: [s.span[0], s.span[1]], from: s.from };
  }

  // 캡처한 파일들에서 작업 단위를 만든다.
  // 워크백 셀 주소를 함께 들고 있어야 수정본 xlsx 를 만들 수 있다.
  function collect() {
    items = [];
    files.forEach(function (f) {
      // 진로활동 묶음 형식은 화면 문장이 실제 저장될 기록과 다를 수 있다(Finding 3,
      // isCareerBundleWorkbook 주석 참고). writeback.plan 이 ok:true 를 돌려주더라도
      // 이 형식이면 표시 전용으로만 쓰고 항상 경고를 붙인다.
      var bundle = isCareerBundleWorkbook(f.workbook);
      var bundleMsg = '이 파일은 진로활동 묶음 형식이라 화면에 보이는 문장이 실제 저장될 기록과 다를 수 있습니다. ' +
        '수정본 내려받기·고친 문장 복사 대신 메인 결과 화면에서 확인해 주세요.';
      var p = g.SGB.writeback.plan(f.workbook);
      if (!p.ok) {
        // 워크백 불가여도 화면에서 고치고 복사는 할 수 있어야 한다 — 단, 번들
        // 형식이면 복사도 막는다(텍스트 자체가 못 미덥다).
        var parsed = g.SGB.parse.parseWorkbook(f.workbook, { fileName: f.name });
        (parsed.students || []).forEach(function (st) {
          (st.entries || []).forEach(function (e) {
            if (!e.text) return;
            items.push(mkItem(st.no, st.name, e.subject, e.text, f.name, null, null,
              bundle ? bundleMsg : p.reason, bundle));
          });
        });
        return;
      }
      p.cells.forEach(function (c) {
        items.push(mkItem(c.no, c.name, c.subject, c.text, f.name, c.addr, c.extra,
          bundle ? bundleMsg : null, bundle));
      });
    });
    current = 0;
  }

  function mkItem(no, name, subject, text, fileName, addr, extra, blockReason, unreliable) {
    var findings = scanOf(text, subject);
    var list = g.SGB.suggest.build(text, findings).concat(g.SGB.suggest.cuts(text));
    // 창체는 세특에 과목 열이 없어 subject 가 항상 '' 다 — 그대로 키에 쓰면
    // 활동유형(동아리/자율/진로/행동특성)이 달라도 번호·성명만 같으면 같은 키로
    // 겹쳐 다른 탭의 선택이 새어 들어간다(Finding 1). 교과 페이지는 원래대로
    // 과목을 쓴다. §8 스펙: 창체는 번호|성명|활동유형.
    var keySubject = g.SGB.rulesSubject ? subject : activeTabType();
    var key = g.SGB.worklist.key(no, name, keySubject);
    var saved = g.SGB.worklist.get(key);
    list.forEach(function (s, i) {
      var idxKey = String(i);
      var meta = saved.meta[idxKey];
      // 저장된 값은 지금 이 인덱스가 저장 당시와 같은 제안(규칙·위치·원문)을
      // 가리킬 때만 되살린다(Finding 2). 수정본을 내려받아 재업로드하면
      // 텍스트·finding·인덱스가 전부 바뀌므로, 인덱스만 믿고 값을 되살리면
      // 엉뚱한 제안(예: 문장 삭제 자리에 동의어 선택값)에 값이 얹힌다. meta 가
      // 없는 옛 기록(신원 정보 저장 이전)도 신원을 확인할 수 없으니 버린다 —
      // 조용히 틀리게 복원하는 것보다 안전하다.
      var matches = !!meta && meta.rule === s.rule &&
        Array.isArray(meta.span) && meta.span[0] === s.span[0] && meta.span[1] === s.span[1] &&
        meta.from === s.from;
      // picks 는 '무엇을 골랐나'(값)만 복원한다. 켜짐/꺼짐은 edits 가 최종
      // 권한을 갖는다 — 순서를 뒤집으면 해제한 선택이 되살아난다.
      if (matches && Object.prototype.hasOwnProperty.call(saved.picks, idxKey)) {
        s.to = saved.picks[idxKey];
        s.on = true;
      }
      if (matches && Object.prototype.hasOwnProperty.call(saved.edits, idxKey)) {
        s.on = saved.edits[idxKey];
      }
    });
    return {
      key: key, no: no, name: name, subject: subject, text: text,
      fileName: fileName, addr: addr, extra: extra || [],
      blockReason: blockReason, unreliable: !!unreliable, suggestions: list
    };
  }

  function esc(s) { return g.SGB.core.escapeHtml(s); }
  function bytesOf(text) {
    return g.SGB.core.byteLen(text, g.SGB.rulesSubject ? 'utf3' : 'neis2');
  }
  function limitOf() {
    var el = document.getElementById('byteLimit');
    return el ? Number(el.value) || 1500 : 1500;
  }

  function buildOverlay() {
    var el = document.createElement('div');
    el.className = 'work-overlay';
    el.id = 'workOverlay';
    el.hidden = true;
    el.innerHTML =
      '<aside class="work-list">' +
        '<div class="work-list__head" id="workProgress">0/0</div>' +
        '<div class="work-list__items" id="workItems"></div>' +
        '<div class="work-list__foot">' +
          '<button type="button" class="btn btn-primary" id="workExportBtn">수정본 내려받기</button>' +
          '<button type="button" class="btn btn-ghost" id="workCloseBtn">닫기 (Esc)</button>' +
        '</div>' +
      '</aside>' +
      '<main class="work-main" id="workMain"></main>' +
      '<aside class="work-bytes" id="workBytes"></aside>';
    document.body.appendChild(el);
    el.querySelector('#workCloseBtn').addEventListener('click', close);

    el.addEventListener('change', function (e) {
      var it = items[current];
      if (!it) return;
      var cb = e.target.closest('input[type="checkbox"][data-idx]');
      if (cb) {
        var i = Number(cb.dataset.idx);
        it.suggestions[i].on = cb.checked;
        g.SGB.worklist.setEdit(it.key, i, cb.checked, suggMeta(it.suggestions[i]));
        renderMain();
        return;
      }
      var radio = e.target.closest('input[type="radio"][data-idx]');
      if (radio) {
        var ri = Number(radio.dataset.idx);
        it.suggestions[ri].to = radio.dataset.alt;
        it.suggestions[ri].on = true;
        g.SGB.worklist.setPick(it.key, ri, radio.dataset.alt, suggMeta(it.suggestions[ri]));
        renderMain();
      }
    });

    el.addEventListener('click', function (e) {
      var pick = e.target.closest('.work-item[data-idx]');
      if (pick) { current = Number(pick.dataset.idx); render(); return; }

      var cut = e.target.closest('[data-cut]');
      if (cut && items[current]) {
        var ci = Number(cut.dataset.cut);
        items[current].suggestions[ci].on = !items[current].suggestions[ci].on;
        g.SGB.worklist.setEdit(items[current].key, ci, items[current].suggestions[ci].on,
          suggMeta(items[current].suggestions[ci]));
        renderMain();
        return;
      }

      if (e.target.closest('#workCopyBtn') && items[current]) {
        var itc = items[current];
        if (itc.unreliable) {
          g.SGB.core.toast('이 항목은 화면 문장이 실제 기록과 다를 수 있어 복사를 지원하지 않습니다. 메인 결과 화면을 이용해 주세요.');
          return;
        }
        g.SGB.exporter.copyIssues(g.SGB.suggest.apply(itc.text, itc.suggestions));
        return;
      }

      if (e.target.closest('#workExportBtn')) { exportFixed(); return; }

      if (e.target.closest('#workNextBtn') && items[current]) {
        g.SGB.worklist.setDone(items[current].key, true);
        if (current < items.length - 1) current++;
        render();
      }
    });

    return el;
  }

  var RULE_TONE = {
    safe: 'm-teal', pattern: 'm-teal', choice: 'm-amber',
    cut: 'm-slate', manual: 'm-brown'
  };

  // 규칙 코드 → 교사가 읽을 라벨. subject-app.js:19 RULE_LABELS 와
  // career-app.js:27 RULE_TAGS 가 같은 표를 갖고 있지만 둘 다 IIFE 안의
  // 지역 var 라 꺼내 쓸 수 없다. 두 페이지 코드를 합쳐 여기 둔다.
  // 표에 없으면 코드를 그대로 보여준다(새 규칙이 생겨도 화면은 살아 있게).
  var RULE_LABELS = {
    R1알파벳: '영문·외국어 표기', R2특수기호: '특수기호', R3과거시제: '과거형 표현',
    R4내면심리: '내면·심리 서술', R5역량어단독: '근거 없는 역량어', R6지칭어: '인물 지칭',
    R7기재금지: '기재불가 항목', R8무관내용: '성취기준 무관', R9줄바꿈도서명: '줄바꿈·따옴표 표기',
    R10분량: '분량 초과', F1외국어확인: '원어 표기 (확인 필요)', F2파일형식확인: '파일 형식 (확인 필요)',
    C1진로전공: '진로·전공 언급 (확인 필요)', C2학과직업: '학과·직업명 언급 (확인 필요)',
    U1대학명: '대학명 언급', U2기관인증: '교외 기관·인증시험 언급 (확인 필요)',
    U3부모직업: '부모 직업 암시 (기재불가)', N1기재유의어: '기재 유의어', N2괄호영문: '괄호 안 영문 표기',
    S1추측표현: '추측성 표현', S2미사여구: '미사여구', S3패턴반복: '문장 패턴 반복',
    S4템플릿반복: '상투적 템플릿 반복', S5종결혼용: '문장 종결 혼용', S6띄어쓰기: '띄어쓰기·표기 오류',
    S7과정부족: '과정·역할 서술 부족', S8문장중복: '문장 중복',
    M1성취기준코드: '성취기준 코드 직접 인용', M2수식기호: '수식 기호 직접 사용',
    PROHIBITED: '기재불가', ORG: '기관·사교육', CAUTION: '기재유의어', QUOTE: '따옴표',
    MIDDOT: '가운뎃점', PARENROMAN: '괄호영문', PLACEHOLDER: '형식표현', FLOWERY: '미사여구',
    CAREER_LACK: '진로연계부족', PROCESS_LACK: '과정부족', SPECULATIVE: '추측표현',
    PATTERN: '패턴반복', TEMPLATE: '템플릿', ENDING: '종결혼용', SPACING: '띄어쓰기',
    DUP: '문장중복', CUT: '문장 삭제'
  };
  function ruleLabel(code) { return RULE_LABELS[code] || code; }

  function renderList() {
    var keys = items.map(function (it) { return it.key; });
    var pr = g.SGB.worklist.progress(keys);
    document.getElementById('workProgress').textContent = pr.done + '/' + pr.total + ' 완료';
    document.getElementById('workItems').innerHTML = items.map(function (it, i) {
      var done = g.SGB.worklist.get(it.key).done;
      return '<button type="button" class="work-item' + (i === current ? ' current' : '') +
        (done ? ' done' : '') + '" data-idx="' + i + '">' +
        '<span class="work-item__mark">' + (done ? '✔' : (i === current ? '▶' : '')) + '</span>' +
        '<span>' + esc(it.name) + (it.subject ? ' · ' + esc(it.subject) : '') + '</span></button>';
    }).join('');
  }

  function renderMain() {
    var it = items[current];
    if (!it) {
      document.getElementById('workMain').innerHTML =
        '<p class="work-note">먼저 엑셀을 올려주세요.</p>';
      document.getElementById('workBytes').innerHTML = '';
      return;
    }
    var fixed = g.SGB.suggest.apply(it.text, it.suggestions);

    var rows = it.suggestions.map(function (s, i) {
      if (s.kind === 'cut') return '';
      var right;
      if (s.kind === 'manual') right = '<span class="work-sugg__to">직접 고치세요</span>';
      else if (s.kind === 'choice') {
        right = s.alts.map(function (a, j) {
          return '<label><input type="radio" name="alt' + i + '" data-idx="' + i +
            '" data-alt="' + esc(a) + '"' + (s.to === a ? ' checked' : '') + '> ' + esc(a) + '</label>';
        }).join(' ');
      } else right = '<span class="work-sugg__to">' + esc(s.to) + '</span>';

      return '<div class="work-sugg__row' + (s.kind === 'manual' ? ' is-manual' : '') + '">' +
        (s.kind === 'manual' ? '<span style="width:16px"></span>'
          : '<input type="checkbox" data-idx="' + i + '"' + (s.on ? ' checked' : '') + '>') +
        '<span class="work-sugg__rule ' + RULE_TONE[s.kind] + '">' + esc(ruleLabel(s.rule)) + '</span>' +
        '<span><span class="work-sugg__from">' + esc(s.from) + '</span> → ' + right + '</span>' +
        '</div>';
    }).join('');

    document.getElementById('workMain').innerHTML =
      '<div class="work-main__head">' +
        '<span class="work-main__who">' + esc(it.name) + ' ' + esc(it.no) +
          (it.subject ? ' · ' + esc(it.subject) : '') + '</span>' +
        '<span class="work-note">' + esc(it.fileName) + '</span>' +
      '</div>' +
      '<div class="work-block"><p class="work-block__label">원문</p>' +
        '<p class="work-text">' + esc(it.text) + '</p></div>' +
      '<div class="work-block"><p class="work-block__label">수정안</p>' +
        '<div class="work-sugg">' + (rows || '<p class="work-note">고칠 것이 없습니다.</p>') + '</div></div>' +
      '<div class="work-block"><p class="work-block__label">결과 미리보기</p>' +
        '<div class="work-preview"><p class="work-text">' + esc(fixed) + '</p></div></div>' +
      '<div class="work-block">' +
        '<button type="button" class="btn btn-ghost" id="workCopyBtn"' +
          (it.unreliable ? ' disabled title="화면 문장이 실제 기록과 다를 수 있어 복사할 수 없습니다"' : '') +
          '>고친 문장 복사</button> ' +
        '<button type="button" class="btn btn-primary" id="workNextBtn">완료 → 다음</button>' +
      '</div>' +
      (it.blockReason ? '<p class="work-note">' + esc(it.blockReason) + '</p>' : '');

    renderBytes(it, fixed);
  }

  function renderBytes(it, fixed) {
    var lim = limitOf();
    var b = bytesOf(fixed);
    var pct = Math.min(100, Math.round(b / lim * 100));
    var sents = it.suggestions.filter(function (s) { return s.kind === 'cut'; });
    document.getElementById('workBytes').innerHTML =
      '<p class="work-bytes__total">' + b.toLocaleString() + ' / ' + lim.toLocaleString() + 'B</p>' +
      '<div class="gauge"><div class="gauge-fill" style="transform:scaleX(' + (pct / 100) + ')"></div></div>' +
      '<div class="work-bytes__list">' + sents.map(function (s) {
        var i = it.suggestions.indexOf(s);
        return '<div class="work-sent' + (s.on ? ' is-cut' : '') + '">' +
          '<span>' + bytesOf(s.from) + 'B</span>' +
          '<span class="work-sent__cut" data-cut="' + i + '">' + (s.on ? '되살리기' : '⌫') + '</span>' +
          '</div>';
      }).join('') + '</div>';
  }

  function render() { renderList(); renderMain(); }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // isCareerBundleWorkbook 은 파일 맨 위(document 가드보다 앞)에 정의돼 있다 —
  // Node 테스트에서도 부를 수 있어야 해서다. 자세한 배경은 그 정의부 주석 참고.

  // 파일별로 수정된 셀을 모아 원본 양식 그대로 다시 쓴다.
  // 여러 파일이면 zip 으로 묶는다 — JSZip 이 없는 페이지(창체)에서는 단일
  // 파일만 지원한다. 버튼 자체는 숨기지 않는다(Finding 6) — 아래 `if (!g.JSZip)`
  // 분기가 클릭 시점에 토스트로 안내하고 아무것도 내려받지 않을 뿐이다.
  //
  // items 의 addr === null 항목(워크백 불가 파일)은 제외한다. 각 파일은
  // 다시 plan() 해 그 파일의 extra(연속행) 정보를 build() 에 넘겨야
  // build 가 연속행을 비운다 — 안 그러면 재파싱 때 꼬리가 중복된다.
  function exportFixed() {
    // 기본 체크된 제안(§6.1)은 "미리보기가 그 역할을 한다"는 전제로 허용된다.
    // 그런데 학생을 한 번도 열어보지 않으면 그 미리보기 자체가 안 열린다 —
    // 그 안전장치가 발동한 적이 없는 학생까지 조용히 함께 내보내면 교사가
    // 승인한 적 없는 수정이 NEIS 업로드 파일에 들어간다(Finding 5).
    var keys = items.map(function (it) { return it.key; });
    var pr = g.SGB.worklist.progress(keys);
    var unreviewed = pr.total - pr.done;
    var exportItems = items;
    if (unreviewed > 0) {
      var onlyReviewed = window.confirm(
        '아직 확인하지 않은 항목이 ' + unreviewed + '건 있습니다(' + pr.done + '/' + pr.total + ' 완료).\n' +
        '확인을 누르면 확인을 마친 항목만 내려받고, 취소를 누르면 미확인 항목을 포함한 전체를 내려받습니다.'
      );
      if (onlyReviewed) {
        exportItems = items.filter(function (it) { return g.SGB.worklist.get(it.key).done; });
        if (!exportItems.length) {
          g.SGB.core.toast('확인을 마친 항목이 없어 내려받을 수 있는 파일이 없습니다.');
          return;
        }
      }
    }

    var byFile = {};
    exportItems.forEach(function (it) {
      if (!it.addr) return;
      if (!byFile[it.fileName]) byFile[it.fileName] = {};
      byFile[it.fileName][it.addr] = g.SGB.suggest.apply(it.text, it.suggestions);
    });
    var names = Object.keys(byFile);
    if (!names.length) { g.SGB.core.toast('수정본을 만들 수 있는 파일이 없습니다.'); return; }

    function outName(n) { return n.replace(/\.(xlsx|xls)$/i, '') + '_수정본.xlsx'; }

    if (names.length === 1) {
      var f = files.filter(function (x) { return x.name === names[0]; })[0];
      if (!f) { g.SGB.core.toast('원본 파일을 찾지 못했습니다.'); return; }
      if (isCareerBundleWorkbook(f.workbook)) {
        g.SGB.core.toast('진로활동 묶음 형식은 화면 문장과 실제 저장될 셀 내용이 다를 수 있어 수정본을 만들 수 없습니다. "고친 문장 복사"로 NEIS에 직접 붙여넣어 주세요.');
        return;
      }
      var pl = g.SGB.writeback.plan(f.workbook);
      if (!pl.ok) { g.SGB.core.toast(pl.reason || '이 파일은 수정본을 만들 수 없습니다.'); return; }
      var buf = g.SGB.writeback.build(f.workbook, byFile[names[0]], pl);
      download(new Blob([buf], { type: 'application/octet-stream' }), outName(names[0]));
      g.SGB.core.toast('수정본을 내려받았습니다. NEIS에 업로드하세요.');
      return;
    }

    if (!g.JSZip) {
      g.SGB.core.toast('파일이 여러 개면 학생별 텍스트가 합쳐져 어느 파일 것인지 알 수 없습니다. 한 파일씩 올려주세요.');
      return;
    }
    var zip = new g.JSZip();
    var skipped = [];
    names.forEach(function (n) {
      var wf = files.filter(function (x) { return x.name === n; })[0];
      if (!wf) { skipped.push(n); return; }
      if (isCareerBundleWorkbook(wf.workbook)) { skipped.push(n); return; }
      var wp = g.SGB.writeback.plan(wf.workbook);
      if (!wp.ok) { skipped.push(n); return; }
      zip.file(outName(n), g.SGB.writeback.build(wf.workbook, byFile[n], wp));
    });
    if (!Object.keys(zip.files).length) {
      g.SGB.core.toast('수정본을 만들 수 있는 파일이 없습니다.');
      return;
    }
    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      download(blob, 'saenggibu_수정본.zip');
      var made = names.length - skipped.length;
      var msg = '수정본 ' + made + '개를 내려받았습니다.';
      if (skipped.length) msg += ' (' + skipped.length + '개는 제외: 워크백 불가)';
      g.SGB.core.toast(msg);
    });
  }

  function open() {
    if (!overlay) overlay = buildOverlay();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    collect();
    render();
  }
  function close() {
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', function (e) {
    if (!overlay || overlay.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;

    if (e.key === 'j' || e.key === 'J') {
      if (current < items.length - 1) { current++; render(); }
      e.preventDefault();
    } else if (e.key === 'k' || e.key === 'K') {
      if (current > 0) { current--; render(); }
      e.preventDefault();
    } else if (e.key === ' ') {
      if (items[current]) {
        g.SGB.worklist.setDone(items[current].key, true);
        if (current < items.length - 1) current++;
        render();
      }
      e.preventDefault();
    } else if (e.key === 'c' || e.key === 'C') {
      if (items[current]) {
        if (items[current].unreliable) {
          g.SGB.core.toast('이 항목은 화면 문장이 실제 기록과 다를 수 있어 복사를 지원하지 않습니다. 메인 결과 화면을 이용해 주세요.');
        } else {
          g.SGB.exporter.copyIssues(g.SGB.suggest.apply(items[current].text, items[current].suggestions));
        }
      }
      e.preventDefault();
    }
  });

  wireCapture();
  var btn = document.getElementById('workModeBtn');
  if (btn) btn.addEventListener('click', open);

  g.SGB.workApp = {
    open: open,
    close: close,
    render: render,
    isCareerBundleWorkbook: isCareerBundleWorkbook,
    _files: function () { return files; },
    _overlay: function () { return overlay; },
    _items: function () { return items; }
  };
})();
