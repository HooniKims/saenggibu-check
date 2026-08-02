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
    return el;
  }

  function open() {
    if (!overlay) overlay = buildOverlay();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (g.SGB.workApp.render) g.SGB.workApp.render();
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
    _files: function () { return files; },
    _overlay: function () { return overlay; }
  };
})();
