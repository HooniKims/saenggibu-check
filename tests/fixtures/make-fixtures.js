// NEIS 양식 테스트 엑셀을 만든다. XLSX.writeFile 로 생성한다.
var path = require('path');
var XLSX = require(path.resolve(__dirname, '../../assets/vendor/xlsx.full.min.js'));
// assets/vendor/xlsx.full.min.js 는 브라우저용 번들이라 Node의 fs 를 자동 연결하지
// 않는다. writeFile 이 디스크에 쓰도록 수동으로 set_fs 를 호출해야 한다.
XLSX.set_fs(require('fs'));

function write(name, aoa, sheetName) {
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName || 'Sheet1');
  XLSX.writeFile(wb, path.join(__dirname, name));
  console.log('  wrote', name);
}

// (A) 표준 그리드 — 과목 열 있음, 병합셀 흉내로 빈 칸 forward-fill 필요
// 첫 세특은 제안 5종을 한 문장에 담는다. Task 7 브라우저 검증이 이걸 그대로 쓴다.
//   학생은(manual) / 정리했고(pattern) / 구글(safe 유의어) /
//   유튜브(choice 유의어) / ‘’(safe 따옴표) / 반론(...)(safe 괄호영문)
write('standard.xlsx', [
  ['학년도', '학기', '과목', '과목코드', '반/번호', '성명', '세부능력 및 특기사항'],
  ['2025', '1', '국어', 'KOR01', '3/1', '김서연',
   "학생은 모둠 토의에서 자료를 정리했고, 구글 문서로 발표문을 작성함. 유튜브 영상을 참고하여 ‘토지’를 읽고 반론(counterargument)을 제시함."],
  ['', '', '', '', '3/2', '박도윤', '토론에 참여했으며 근거를 제시함.'],
  ['', '', '수학', 'MAT01', '3/1', '김서연', '함수 개념을 설명하였다.'],
]);

// (B) 인쇄덤프 — 워크백 거부 대상
write('printdump.xlsx', [
  ['학교생활기록부'], ['사용자명: 홍길동'], ['2025.03.02.'],
  ['3학년 3반'],
  ['과목', '번호', '성명', '', '세부능력 및 특기사항'],
  ['통합사회', '1', '김서연', '', '자료를 분석하여 발표했음.'],
]);

// (C) 창체 동아리 — 단일 파일 워크백 대상
write('club.xlsx', [
  ['2025학년도 동아리활동 학생부 자료기록'], [''],
  ['번호', '성명', '동아리명', '특기사항'],
  ['1', '김서연', '과학탐구반', '실험을 기획하였다. 유튜브 영상을 제작해 공유함.'],
  ['2', '박도윤', '과학탐구반', '데이터를 분석했고 보고서를 작성함.'],
]);
