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
  if (typeof document === 'undefined') return;
  g.SGB = g.SGB || {};

  var files = [];   // [{name, buffer, workbook}]
  var overlay = null;

  function captureFiles(fileList) {
    var list = Array.prototype.slice.call(fileList || []);
    if (!list.length) return;
    files = [];
    list.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var buf = e.target.result;
          files.push({
            name: f.name,
            buffer: buf,
            workbook: g.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false })
          });
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

  // 캡처한 파일들에서 작업 단위를 만든다.
  // 워크백 셀 주소를 함께 들고 있어야 수정본 xlsx 를 만들 수 있다.
  function collect() {
    items = [];
    files.forEach(function (f) {
      var p = g.SGB.writeback.plan(f.workbook);
      if (!p.ok) {
        // 워크백 불가여도 화면에서 고치고 복사는 할 수 있어야 한다.
        var parsed = g.SGB.parse.parseWorkbook(f.workbook, { fileName: f.name });
        (parsed.students || []).forEach(function (st) {
          (st.entries || []).forEach(function (e) {
            if (!e.text) return;
            items.push(mkItem(st.no, st.name, e.subject, e.text, f.name, null, null, p.reason));
          });
        });
        return;
      }
      p.cells.forEach(function (c) {
        items.push(mkItem(c.no, c.name, c.subject, c.text, f.name, c.addr, c.extra, null));
      });
    });
    current = 0;
  }

  function mkItem(no, name, subject, text, fileName, addr, extra, blockReason) {
    var findings = scanOf(text, subject);
    var list = g.SGB.suggest.build(text, findings).concat(g.SGB.suggest.cuts(text));
    var key = g.SGB.worklist.key(no, name, subject);
    var saved = g.SGB.worklist.get(key);
    list.forEach(function (s, i) {
      if (Object.prototype.hasOwnProperty.call(saved.edits, String(i))) s.on = saved.edits[String(i)];
      if (Object.prototype.hasOwnProperty.call(saved.picks, String(i))) {
        s.to = saved.picks[String(i)];
        s.on = true;
      }
    });
    return {
      key: key, no: no, name: name, subject: subject, text: text,
      fileName: fileName, addr: addr, extra: extra || [],
      blockReason: blockReason, suggestions: list
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
        g.SGB.worklist.setEdit(it.key, i, cb.checked);
        renderMain();
        return;
      }
      var radio = e.target.closest('input[type="radio"][data-idx]');
      if (radio) {
        var ri = Number(radio.dataset.idx);
        it.suggestions[ri].to = radio.dataset.alt;
        it.suggestions[ri].on = true;
        g.SGB.worklist.setPick(it.key, ri, radio.dataset.alt);
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
        g.SGB.worklist.setEdit(items[current].key, ci, items[current].suggestions[ci].on);
        renderMain();
        return;
      }

      if (e.target.closest('#workCopyBtn') && items[current]) {
        var itc = items[current];
        g.SGB.exporter.copyIssues(g.SGB.suggest.apply(itc.text, itc.suggestions));
        return;
      }

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
        '<button type="button" class="btn btn-ghost" id="workCopyBtn">고친 문장 복사</button> ' +
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
    if (e.key === 'Escape' && overlay && !overlay.hidden) close();
  });

  wireCapture();
  var btn = document.getElementById('workModeBtn');
  if (btn) btn.addEventListener('click', open);

  g.SGB.workApp = {
    open: open,
    close: close,
    render: render,
    _files: function () { return files; },
    _overlay: function () { return overlay; },
    _items: function () { return items; }
  };
})();
