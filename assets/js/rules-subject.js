/*
 * SGB.rulesSubject — 교과세특 규칙 스캐너
 * 이중 런타임: 브라우저(<script> 순서 로드) / Node(createRequire, 테스트용)
 *
 * SSOT: .claude/skills/setteuk-review/scripts/rule_scan.py (R1~R10·F1·F2)
 * 이 파일의 scanSSOT()는 SSOT와 "정확히 일치"해야 한다 — 규칙이 바뀌면 rule_scan.py를
 * 먼저 고치고 여기를 동기화할 것(docs/rules-sync-diff.md에 기록).
 * scanExtras()는 기존 앱(학교생활기록부 점검기.html)의 ~25종 추가 검사를 이식한
 * 상위집합(superset) — SSOT 판정과 모순되지 않는 새 규칙코드(U/N/S/M 접두)로 분리했다.
 *
 * finding = {rule, grade:'violation'|'check'|'info', span:[s,e], quote, note, color:'m-*'}
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  // ======================================================================
  // 공통 유틸
  // ======================================================================
  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function findRegexMatches(text, re) {
    var out = [];
    var flags = re.flags.indexOf('g') === -1 ? re.flags + 'g' : re.flags;
    var r = new RegExp(re.source, flags);
    var m;
    while ((m = r.exec(text)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
      if (m[0].length === 0) r.lastIndex++;
    }
    return out;
  }

  function ctx(text, s, e, pad) {
    pad = pad == null ? 12 : pad;
    return text.slice(Math.max(0, s - pad), Math.min(text.length, e + pad));
  }

  function mk(rule, grade, color, start, end, quote, note) {
    return { rule: rule, grade: grade, span: [start, end], quote: quote, note: note, color: color };
  }

  // ord(c) > 127 → 3바이트(UTF-8 한글과 동일 계산). checker-core.byteLen(mode:'utf3')와 동일 알고리즘
  // 이지만, 로드 순서에 의존하지 않도록 이 모듈 내부에 독립 구현한다.
  function byteLenUtf3(text) {
    var s = text == null ? '' : String(text);
    var bytes = 0;
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp > 0xFFFF) i++; // 서로게이트 쌍 보정
      bytes += cp > 127 ? 3 : 1;
    }
    return bytes;
  }

  function findKeywordMatches(text, keywords) {
    var sorted = keywords.slice().sort(function (a, b) { return b.length - a.length; });
    var results = [];
    var used = [];
    sorted.forEach(function (kw) {
      var idx = 0;
      while (true) {
        var found = text.indexOf(kw, idx);
        if (found === -1) break;
        var end = found + kw.length;
        var overlaps = used.some(function (r) { return !(end <= r[0] || found >= r[1]); });
        if (!overlaps) {
          results.push({ start: found, end: end, match: kw });
          used.push([found, end]);
        }
        idx = found + 1;
      }
    });
    return results;
  }

  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }

  // ======================================================================
  // §SSOT 상수 (rule_scan.py 그대로 복사 — 값 변경 금지, 바뀌면 SSOT부터)
  // ======================================================================
  // [원본 대비 수정 — 2026-08-02] 원본은 ['일본어', '공통영어'] 뿐이었다.
  // 부분일치라 '공통영어1'은 걸렸지만 '영어'·'실용영어'·'영어독해와작문'은 걸리지 않아,
  // 해당 과목 세특의 영단어가 전부 R1(확정 위반)로 표시됐다. 교과 프로파일 드롭다운으로
  // 우회할 수는 있으나 그 설정은 전 과목 일괄 적용이라 과목이 섞인 파일에서는 답이 없었다.
  // → 외국어 교과 전반으로 넓힌다. 판정 로직 자체는 그대로다(목록만 확장).
  //    이 과목들의 알파벳·가나는 R1(위반)이 아니라 F1(확인 필요)로 내려간다.
  var FOREIGN_SUBJECTS = [
    '영어', '일본어', '중국어', '독일어', '프랑스어', '스페인어', '러시아어',
    '아랍어', '베트남어'
  ];
  var FILE_FORMATS = { GIF: 1, JPG: 1, JPEG: 1, PNG: 1, PDF: 1, SVG: 1, PSD: 1, MP4: 1 };
  var CURLY_QUOTES = '‘’“”'; // ‘’“”
  var MIND_WORDS = [
    '느꼈', '느낌', '느끼', '깨달', '깨닫', '생각함', '생각하게', '생각을',
    '다짐', '흥미를', '관심을 느', '고민함', '고민하', '성찰함', '성찰하',
    '사고를 확장', '사고가 확장', '가치관을', '인식을 확장', '인식이 확장',
    '자신감을 얻', '자신감을 갖', '기대함', '기대를', '즐거워', '만족감',
    '자부심', '보람을', '감동을', '감명을', '매력을 느', '호기심을 느'
  ];
  var COMPETENCY_RE = /[가-힣\s]{0,6}(?:탐구력|사고력|의사소통 능력|문제 해결 능력|문제해결력|학업역량|전공적합성|창의성|리더십|협업 능력|분석력|이해력)[이가]?\s*(?:뛰어남|우수함|돋보임|탁월함|높음)/g;
  var PRONOUN_RE = /학생[은이]|그는|그녀는|본인[은이]/g;
  var BANNED_ITEMS = [
    { re: /[가-힣]{2,}대학교?(?=[에의를을와과 ,.]|$)/g, note: '대학명 의심' },
    { re: /토익|토플|텝스|오픽|아이엘츠|제이엘피티|일본어능력시험|한국어능력시험|급수/g, note: '어학시험·급수 의심' },
    { re: /소논문/g, note: '소논문' },
    { re: /전국대회|시도대회|공모전 (?:수상|입상)|올림피아드/g, note: '교외 수상·실적 의심' }
  ];
  var IRRELEVANT = [
    { re: /맞춤법/g, note: '맞춤법 언급' },
    { re: /글씨/g, note: '글씨 언급' },
    { re: /출석|결석|지각/g, note: '출석 관련' },
    { re: /분량[을이] (?:채|넘|맞)/g, note: '분량 언급' }
  ];
  var JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  function decompose(ch) {
    var code = ch.codePointAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return null;
    var i = code - 0xAC00;
    return { cho: Math.floor(i / 588), jung: JUNG[Math.floor((i % 588) / 28)], jong: JONG[i % 28] };
  }

  // 했·갔·봤·됐·냈·왔·섰·펐 등 'ㅏ/ㅐ/ㅓ/ㅔ/ㅕ/ㅘ/ㅙ/ㅝ/ㅞ + ㅆ받침' 축약 과거형. '겠'(미래·추측)은 제외.
  function isPastContraction(ch) {
    if (ch === '겠') return false;
    var d = decompose(ch);
    if (!d) return false;
    return d.jong === 'ㅆ' && 'ㅏㅐㅓㅔㅕㅘㅙㅝㅞ'.indexOf(d.jung) !== -1;
  }

  // 작은따옴표 짝 내부(도서명·작품명) 구간 — 과거시제 예외 처리용
  function quoteRanges(text) {
    var idxs = [];
    var re = /['‘’]/g;
    var m;
    while ((m = re.exec(text)) !== null) idxs.push(m.index);
    var ranges = [];
    for (var i = 0; i + 1 < idxs.length; i += 2) ranges.push([idxs[i], idxs[i + 1]]);
    return ranges;
  }
  function inRanges(pos, ranges) {
    return ranges.some(function (r) { return r[0] <= pos && pos <= r[1]; });
  }

  // ======================================================================
  // §SSOT scanSSOT(text, isForeign, byteLimit) — R1~R10·F1·F2
  // ======================================================================
  function scanSSOT(text, isForeign, byteLimit) {
    var f = [];
    var qr = quoteRanges(text);

    // R1 알파벳 / F1 외국어(가나 포함) / F2 파일형식
    findRegexMatches(text, /[A-Za-z]+/g).forEach(function (m) {
      var upper = m.match.toUpperCase();
      if (FILE_FORMATS[upper]) {
        f.push(mk('F2파일형식확인', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end),
          "파일 형식명 '" + m.match + "' — 음차가 어색할 수 있어 교사 판단 필요"));
        return;
      }
      if (isForeign) {
        f.push(mk('F1외국어확인', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end), "알파벳 '" + m.match + "'"));
      } else {
        f.push(mk('R1알파벳', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), "알파벳 '" + m.match + "'"));
      }
    });
    findRegexMatches(text, /[぀-ヿㇰ-ㇿ]+/g).forEach(function (m) {
      if (isForeign) {
        f.push(mk('F1외국어확인', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end), "일본어 문자 '" + m.match + "'"));
      } else {
        f.push(mk('R1알파벳', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), "일본어 문자 '" + m.match + "'"));
      }
    });

    // R2 특수기호 — '능력단위:' 쌍점만 면제
    var allowedColons = {};
    findRegexMatches(text, /능력단위\s*:/g).forEach(function (m) { allowedColons[m.end - 1] = true; });
    findRegexMatches(text, /[·\/~\-:;*∼‧ㆍ]/g).forEach(function (m) {
      if (m.match === ':' && allowedColons[m.start]) return;
      f.push(mk('R2특수기호', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), "기호 '" + m.match + "'"));
    });

    // R3 과거시제: 았/었/였 음절, ㅆ받침 축약, ~던
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (!('았었였'.indexOf(ch) !== -1 || isPastContraction(ch))) continue;
      if (inRanges(i, qr)) continue; // 도서명·작품 고유명칭 내부는 예외
      var s = i, e = i;
      while (s > 0 && ' .,'.indexOf(text[s - 1]) === -1) s--;
      while (e < text.length - 1 && ' .,'.indexOf(text[e + 1]) === -1) e++;
      var word = text.slice(s, e + 1);
      var tail = text.slice(i + 1, e + 1);
      if (/^다[고는며]/.test(tail)) {
        // '기여했다고 판단함'처럼 학생이 제시·판단한 '내용' 안의 과거형 — 확인 필요로 격상(위반 단정 아님)
        f.push(mk('R3과거시제', 'check', 'm-brown', s, e + 1, word, '내용 안의 과거형 — 행동 서술어가 현재형이면 유지 가능(교사 판단)'));
      } else {
        f.push(mk('R3과거시제', 'violation', 'm-red', s, e + 1, word, "과거형 음절 '" + ch + "'"));
      }
    }
    findRegexMatches(text, /[가-힣]던/g).forEach(function (m) {
      if (inRanges(m.start, qr)) return;
      f.push(mk('R3과거시제', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end), "회상형 '~던' 의심(어간 일부일 수 있음 — 확인)"));
    });

    // R4 내면 심리
    MIND_WORDS.forEach(function (w) {
      findRegexMatches(text, new RegExp(escapeRegex(w), 'g')).forEach(function (m) {
        f.push(mk('R4내면심리', 'info', 'm-rose', m.start, m.end, ctx(text, m.start, m.end), "내면·심리 표현 '" + w + "'"));
      });
    });

    // R5 결론 역량어 단독
    findRegexMatches(text, COMPETENCY_RE).forEach(function (m) {
      f.push(mk('R5역량어단독', 'info', 'm-rose', m.start, m.end, m.match, '결론 역량어 — 근거 동반 여부 확인'));
    });

    // R6 인물 지칭어
    findRegexMatches(text, PRONOUN_RE).forEach(function (m) {
      f.push(mk('R6지칭어', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end), "지칭어 '" + m.match + "' 의심(합성어 오탐 가능)"));
    });

    // R7 기재 금지 항목
    BANNED_ITEMS.forEach(function (item) {
      findRegexMatches(text, item.re).forEach(function (m) {
        f.push(mk('R7기재금지', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), item.note));
      });
    });

    // R8 성취기준 무관 내용
    IRRELEVANT.forEach(function (item) {
      findRegexMatches(text, item.re).forEach(function (m) {
        f.push(mk('R8무관내용', 'check', 'm-brown', m.start, m.end, ctx(text, m.start, m.end), item.note));
      });
    });

    // R9 줄바꿈·도서명 표기
    findRegexMatches(text, /[\r\n]+/g).forEach(function (m) {
      f.push(mk('R9줄바꿈도서명', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), '줄바꿈 존재(통문단 위반)'));
    });
    findRegexMatches(text, /[『』「」《》〈〉]/g).forEach(function (m) {
      f.push(mk('R9줄바꿈도서명', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), "겹화살괄호류 '" + m.match + "' — 작은따옴표 표기 위반"));
    });
    findRegexMatches(text, new RegExp('[' + CURLY_QUOTES + ']', 'g')).forEach(function (m) {
      f.push(mk('R9줄바꿈도서명', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), "굽은 따옴표 '" + m.match + "' — 곧은 작은따옴표(')로 수정"));
    });
    var quoteCount = (text.match(/['‘’]/g) || []).length;
    if (quoteCount % 2 === 1) {
      f.push(mk('R9줄바꿈도서명', 'violation', 'm-red', 0, 0, '', '작은따옴표 짝 불일치(홀수 개)'));
    }

    // R10 분량 (한글 3바이트 기준, 기본 1500B — UI 설정값 반영)
    var limit = byteLimit || 1500;
    var nbytes = byteLenUtf3(text);
    if (nbytes > limit) {
      // SSOT는 span=[0, len(text)] 전체를 덮지만, 그대로 쓰면 하이라이트가 문단 전체를 삼켜
      // 다른 표시를 가린다. 게이지(.gauge)가 이미 초과를 보여주므로 span은 0폭으로 두고
      // 이슈 목록·엑셀 내보내기용 정보만 담는다.
      f.push(mk('R10분량', 'violation', 'm-red', 0, 0, '', text.length + '자/' + nbytes + '바이트 — ' + limit + '바이트 초과'));
    }

    return f;
  }

  // ======================================================================
  // §확장 상수 (기존 앱 학교생활기록부 점검기.html 이식 — 상위집합)
  // ======================================================================
  var CAREER_KEYWORDS = [
    '전공을 희망', '희망 전공', '희망 학과', '장래희망', '장래 희망', '진학을 희망', '진학하여', '진학한 후',
    '졸업 후', '지망하는', '희망 직업', '장래 목표', '진로 목표', '꿈을 키움', '꿈을 가짐'
  ];
  var CAREER_JIRO_ALLOW = /(?:진로(?:와|를|에|로|의)?\s*(?:융합|연계|탐색|설계|탐구|활동|교육|체험|진학|상담|코스|과정|기반|바탕)|(?:교과|수업|지식|학습).{0,12}진로|진로.{0,12}(?:교과|수업|지식|융합)|(?:으로|로)의\s*진로(?:를)?\s*(?:바탕|토대))/;
  var MAJOR_JOB_REGEX = /[가-힣]{2,10}(?:학과|학부|전공|계열)(?:를|을|로|에)?|(?<![가-힣])(?:의사|간호사|변호사|판사|공무원|프로그래머|개발자|약사|회계사|기자|디자이너)(?:를|을|로|가|이)?(?![가-힣])/g;
  var JOB_EXCLUDE = { 교사: 1, 선생님: 1, 담임: 1, 교과: 1, 교장: 1, 교감: 1, 부장: 1, 감독: 1 };
  var UNIVERSITY_KEYWORDS = [
    '서울대', '연세대', '고려대', '카이스트', 'KAIST', '포스텍', 'POSTECH', '성균관대', '한양대', '중앙대', '경희대',
    '이화여대', '서강대', '시립대', '건국대', '동국대', '숭실대', '아주대', '인하대', '부산대', '전남대', '전북대', '충남대',
    '경북대', '강원대', '제주대', 'UNIST', 'GIST', 'DGIST', 'UST', '한국외대', '국민대', '홍익대', '숙명여대', '광운대'
  ];
  var ORG_KEYWORDS = [
    '학원', '과외', '사교육', '컨설팅', '멘토링 프로그램', '캠프 참가', '인강', 'EBSi', '메가스터디', '대성마이맥',
    '이투스', '스카이에듀', '올림피아드', '경시대회', 'kmo', 'KMO', '자격증 취득', '인증시험', '교외', '사설',
    '토익', 'TOEIC', '토플', 'TOEFL', '텝스', 'TEPS', 'IELTS', 'SAT', 'AP시험', 'JLPT', 'HSK', '컴활', '정보처리기사',
    '한국사능력검정', '한능검', '실용영어', 'YBM', 'Duolingo'
  ];
  var PARENT_JOB_RE = /부모님 직업|아버지는|어머니는|부모의 직업|부모 직장/g;

  var CAUTION_TERMS = [
    { terms: ['Google Classroom', '구글 클래스룸', '구글클래스룸'], alt: '학습 플랫폼' },
    { terms: ['EBS 온라인 클래스', 'EBS온라인클래스'], alt: '학습 플랫폼' },
    { terms: ['Google Docs', '구글 독스', '구글독스', '구글문서'], alt: '온라인 문서 편집기' },
    { terms: ['Google TV', '구글티비', '구글 TV'], alt: '동영상 플랫폼' },
    { terms: ['Premiere Pro', '프리미어 프로', 'Final Cut Pro', '파이널 컷 프로', '파이털 컷 프로'], alt: '영상 제작·편집 프로그램' },
    { terms: ['Disney Plus', 'Disney+', '디즈니플러스', 'disneyplus'], alt: '동영상 플랫폼' },
    { terms: ['Gather Town', 'Gater Town', '개더타운'], alt: '메타버스 플랫폼' },
    { terms: ['Galaxy Tab', '갤럭시탭', '갤럭시 탭'], alt: '태블릿 PC' },
    { terms: ['Holland Test', '홀랜드 검사', '홀랜드검사'], alt: '직업흥미 검사' },
    { terms: ['CareerNet', '커리어넷'], alt: '진로정보망' },
    { terms: ['Majormap', '메이저맵'], alt: '진로정보 사이트' },
    { terms: ['KakaoTalk', '카카오톡', '카톡'], alt: '메신저·메신저 서비스' },
    { terms: ['Instagram', '인스타그램', '인스타'], alt: 'SNS·소셜 네트워크 서비스' },
    { terms: ['YouTube', '유튜브', 'YouTuber', '유튜버'], alt: '동영상 플랫폼·영상 창작자' },
    { terms: ['Netflix', '넷플릭스', 'netflix'], alt: '동영상 플랫폼' },
    { terms: ['TikTok', 'Tic Tok', '틱톡'], alt: '엔터테인먼트 플랫폼' },
    { terms: ['miricanvas', '미리캔버스', 'Miricanvas'], alt: '디자인 제작 플랫폼' },
    { terms: ['mangoboard', '망고보드', 'Mangoboard'], alt: '디자인 제작 플랫폼' },
    { terms: ['Canva', '캔바'], alt: '디자인 제작 플랫폼' },
    { terms: ['ZEPETO', '제페토', 'Zepeto'], alt: '메타버스 플랫폼' },
    { terms: ['ifland', '이프랜드'], alt: '메타버스 소셜커뮤니케이션서비스' },
    { terms: ['Classting', '클래스팅'], alt: '학습 플랫폼·수업 관리 도구' },
    { terms: ['ThinkerBell', '씽커벨', '띵커벨'], alt: '온라인 협업 플랫폼' },
    { terms: ['Padlet', '패들릿', '패들렛'], alt: '온라인 협업 플랫폼' },
    { terms: ['ChatGPT', 'Chat GPT', 'chat gpt', 'Chat gpt', '챗GPT', '챗지피티'], alt: '대화형 인공지능·생성형 인공지능' },
    { terms: ['Text-To-Speech'], alt: '음성 합성' },
    { terms: ['Chromebook', 'chrome book', '크롬북'], alt: '휴대용 컴퓨터' },
    { terms: ['Google', '구글'], alt: '포털사이트' },
    { terms: ['Naver', '네이버'], alt: '포털사이트' },
    { terms: ['DAUM', 'Daum'], alt: '포털사이트' },
    { terms: ['TVING', '티빙', 'Tving'], alt: '동영상 플랫폼' },
    { terms: ['wavve', '웨이브', 'Wavve'], alt: '동영상 플랫폼' },
    { terms: ['watcha', '왓챠', 'Watcha'], alt: '동영상 플랫폼' },
    { terms: ['Vllo', 'VLLO'], alt: '영상 제작·편집 프로그램' },
    { terms: ['Twitter', '트위터'], alt: 'SNS·소셜 네트워크 서비스' },
    { terms: ['LINE', '라인'], alt: 'SNS·소셜 네트워크 서비스' },
    { terms: ['Allo', '알로'], alt: '온라인 협업 도구' },
    { terms: ['ZOOM', 'Zoom', '줌 미팅', 'Zoom 미팅', 'ZOOM 미팅'], alt: '화상회의', boundary: true },
    { terms: ['UNESCO'], alt: '국제기구' },
    { terms: ['NATO'], alt: '국제기구' },
    { terms: ['IAEA'], alt: '국제기구' },
    { terms: ['OECD'], alt: '국제기구' },
    { terms: ['iPad', '아이패드'], alt: '태블릿 PC' },
    { terms: ['Meta', 'Metta', '메타'], alt: 'SNS·소셜 네트워크 서비스', boundary: true },
    { terms: ['HTML'], alt: '하이퍼텍스트 마크업 언어·웹 페이지 제작 언어', boundary: true },
    { terms: ['CSS', '씨에스에스'], alt: '스타일 시트 언어', boundary: true },
    { terms: ['MBTI'], alt: '성격유형 검사', boundary: true },
    { terms: ['TTS'], alt: '음성 합성', boundary: true },
    { terms: ['KTX'], alt: '고속철도', boundary: true },
    { terms: ['SRT'], alt: '고속철도', boundary: true },
    { terms: ['UN'], alt: '국제기구', boundary: true },
    { terms: ['EU'], alt: '국제기구', boundary: true },
    { terms: ['WHO'], alt: '국제기구', boundary: true },
    { terms: ['WTO'], alt: '국제기구', boundary: true },
    { terms: ['IMF'], alt: '국제기구', boundary: true },
    { terms: ['VR'], alt: '가상현실', boundary: true },
    { terms: ['AR'], alt: '증강현실', boundary: true }
  ];
  var CAUTION_FLAT = [];
  CAUTION_TERMS.forEach(function (row) {
    row.terms.forEach(function (term) {
      CAUTION_FLAT.push({ term: term, alt: row.alt, boundary: !!row.boundary });
    });
  });
  CAUTION_FLAT.sort(function (a, b) { return b.term.length - a.term.length; });

  function hasWordBoundary(text, start, end) {
    var before = start > 0 ? text[start - 1] : '';
    var after = end < text.length ? text[end] : '';
    if (/[가-힣]/.test(before) || /[가-힣]/.test(after)) return false;
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return false;
    return true;
  }

  function findCautionMatches(text) {
    var results = [];
    var used = [];
    var lower = text.toLowerCase();
    CAUTION_FLAT.forEach(function (row) {
      var term = row.term, alt = row.alt, boundary = row.boundary;
      var q = term.toLowerCase();
      var needBoundary = boundary || term.length <= 2 || (/^[가-힣]+$/.test(term) && term.length <= 3);
      var idx = 0;
      while (idx < text.length) {
        var found = -1, matchLen = term.length;
        if (needBoundary && /^[A-Za-z]/.test(term)) {
          var re = new RegExp('(?<![A-Za-z0-9])' + escapeRegex(term) + '(?![A-Za-z0-9])', 'gi');
          re.lastIndex = idx;
          var m = re.exec(text);
          if (!m) break;
          found = m.index;
          matchLen = m[0].length;
          idx = found + matchLen;
        } else {
          found = lower.indexOf(q, idx);
          if (found === -1) break;
          matchLen = term.length;
          idx = found + 1;
          if (needBoundary && !hasWordBoundary(text, found, found + matchLen)) continue;
        }
        var end = found + matchLen;
        var overlaps = used.some(function (r) { return !(end <= r[0] || found >= r[1]); });
        if (!overlaps) {
          results.push({ start: found, end: end, match: text.slice(found, end), alt: alt });
          used.push([found, end]);
        }
      }
    });
    return results;
  }

  function findCareerKeywordMatches(text) {
    return findKeywordMatches(text, CAREER_KEYWORDS).filter(function (m) {
      if (!/진로/.test(m.match)) return true;
      var context = text.slice(Math.max(0, m.start - 15), Math.min(text.length, m.end + 20));
      return !CAREER_JIRO_ALLOW.test(context);
    });
  }

  function findMajorJobMatches(text) {
    var descriptiveAfter = /^\s*(?:소유|사용|개발|작성|만들|제공|운영|관리|연구|참여|이용|구축|배포|설계|분석|검토|조사|학습)/;
    var careerAfter = /^\s*(?:희망|꿈|지망|목표|되고|되기|되었|준비|진학|입사|취업|되기를|가\s*되)/;
    return findRegexMatches(text, MAJOR_JOB_REGEX).filter(function (m) {
      if (JOB_EXCLUDE[m.match]) return false;
      var after = text.slice(m.end, m.end + 8);
      if (/^의사(?:를|을|가|의|로|이)?/.test(m.match)) {
        var tail1 = text.slice(m.end, m.end + 14);
        if (/^\s*(?:전달|표현|반영|확인|소통|결정|개진|밝히|드러|담|나타내|드러내)/.test(tail1)) return false;
        var before = text.slice(Math.max(0, m.start - 12), m.start);
        if (/(?:자신|본인|개인|자기|스스로)의\s*$/.test(before)) return false;
      }
      if (/^의사/.test(m.match) && /^(?:결정|소통|전달|표현|확인|전환|타존)/.test(after)) return false;
      if (m.match === '기자' && /^(동차|재|망|석)/.test(after)) return false;
      var jobLike = /^(?:개발자|프로그래머|디자이너|약사|회계사|간호사|변호사|판사|공무원)/;
      if (jobLike.test(m.match)) {
        var tail2 = text.slice(m.end, m.end + 12);
        if (descriptiveAfter.test(tail2)) return false;
        if (/(?:가|는|이)$/.test(m.match) && !careerAfter.test(tail2)) return false;
      }
      return true;
    });
  }

  var PAREN_ROMANIZATION_RE = /[가-힣]{1,20}\(([A-Za-z][A-Za-z0-9\-]{1,30})\)/g;
  var PAREN_ROMAN_ACRONYM = { DNA: 1, RNA: 1, AI: 1, VR: 1, AR: 1, AP: 1, IT: 1, PC: 1, TV: 1, CD: 1, GDP: 1, WHO: 1, UN: 1, EU: 1 };
  function findParenRomanizationMatches(text) {
    return findRegexMatches(text, PAREN_ROMANIZATION_RE).filter(function (m) {
      var inner = (m.match.match(/\(([A-Za-z][A-Za-z0-9\-]{1,30})\)/) || [])[1];
      if (!inner) return false;
      if (PAREN_ROMAN_ACRONYM[inner.toUpperCase()]) return false;
      if (/^[A-Z]{2,5}$/.test(inner)) return false;
      return true;
    });
  }

  function isAllowedParenAfterHangul(text, parenIndex) {
    var closeIdx = text.indexOf(')', parenIndex);
    if (closeIdx === -1 || closeIdx - parenIndex > 120) return false;
    var inner = text.slice(parenIndex + 1, closeIdx).trim();
    if (!inner || inner.length > 120) return false;
    if (/^[A-Za-z][A-Za-z0-9\-]{0,30}$/.test(inner)) return false; // 로마자 표기는 별도 규칙에서 검사
    return true;
  }

  var SPECULATIVE_RE = /(?:것\s*같(?:음|다|으며|고|아|아서|은)?|(?:으로|로)\s*보(?:이(?:는|며|나|고|아)?|여|인)|(?<![가-힣])아마(?:도)?(?![가-힣])|추정(?:하(?:는|였|여|며|나)?|됨|되)|추측(?:하(?:는|였|여|며|나)?|됨|되)|(?:할|될)\s*것(?:으로|같)|인\s*듯(?:하(?:다|며|나|고|아)?|함)?|(?:~|\.\.\.)?(?:라\s*)?고\s*짐작)/g;
  function findSpeculativeMatches(text) {
    var academicBefore = /(?:값|수치|수|량|크기|넓이|부피|적분|미분|함수|그래프|데이터|통계|근|계수|오차|면적|확률|농도|온도|속도)\s*(?:을|를)?\s*$/;
    return findRegexMatches(text, SPECULATIVE_RE).filter(function (m) {
      if (!/^추정/.test(m.match)) return true;
      var before = text.slice(Math.max(0, m.start - 20), m.start);
      var after = text.slice(m.start, Math.min(text.length, m.end + 20));
      if (academicBefore.test(before)) return false;
      if (/^추정(?:하(?:는|였|여|며|나)?|하여|해)?\s*(?:탐구|보고서|실험|과제|활동|방법|과정|식|공식|값|근사)/.test(after)) return false;
      return true;
    });
  }

  var PROCESS_WORDS = ['탐구', '분석', '토의', '토론', '발표', '질문', '설명', '자료', '조사', '실험', '증명', '풀이', '과정', '참여', '협력', '시도', '노력', '개선', '사고', '태도', '역할', '활동'];
  function findProcessLack(text) {
    if (text.trim().length < 60) return [];
    if (PROCESS_WORDS.some(function (w) { return text.indexOf(w) !== -1; })) return [];
    return [{ start: 0, end: Math.min(text.length, 40), match: text.slice(0, 40) }];
  }

  var FLOWERY_SEVERE = ['매우 우수', '매우 뛰어난', '발군의', '최고의', '엄청난', '압도적', '최상의', '최우수', '눈부신', '대단히'];
  var FLOWERY_MILD = ['정말로', '탁월한', '탁월함', '뛰어난 역량', '완벽하게', '굉장히', '우수함', '우수한', '훌륭함', '훌륭한', '탁월하게', '뛰어난'];
  function findFloweryMatches(text) {
    var matches = [];
    findKeywordMatches(text, FLOWERY_SEVERE).forEach(function (m) {
      matches.push({ start: m.start, end: m.end, match: m.match, label: '과한 미화·최상급 표현 — 구체적 관찰로 바꿔보세요' });
    });
    var mildHits = findKeywordMatches(text, FLOWERY_MILD);
    var countByWord = {};
    mildHits.forEach(function (m) { countByWord[m.match] = (countByWord[m.match] || 0) + 1; });
    mildHits.forEach(function (m) {
      var n = countByWord[m.match];
      if (n >= 2) matches.push({ start: m.start, end: m.end, match: m.match, label: '"' + m.match + '" ' + n + '회 반복 — 미사여구 남발 의심' });
    });
    if (mildHits.length >= 4) {
      var flagged = {};
      mildHits.forEach(function (m) {
        if (flagged[m.start]) return;
        flagged[m.start] = true;
        matches.push({ start: m.start, end: m.end, match: m.match, label: '미사여구 ' + mildHits.length + '회 사용 — 남발·상투 표현 줄이기 권장' });
      });
    }
    return matches;
  }

  function findPatternRepeats(text) {
    var sentences = splitSentences(text);
    var endingCount = {};
    sentences.forEach(function (s) {
      var ending = s.replace(/[.!?]+$/, '').slice(-8);
      if (ending.length < 4) return;
      endingCount[ending] = (endingCount[ending] || 0) + 1;
    });
    var flaggedEndings = Object.keys(endingCount).filter(function (e) { return endingCount[e] >= 2; });
    var matches = [];
    flaggedEndings.forEach(function (ending) {
      sentences.forEach(function (s) {
        if (s.replace(/[.!?]+$/, '').slice(-8) === ending) {
          var idx = text.indexOf(s);
          if (idx !== -1) matches.push({ start: idx, end: idx + s.length, match: s, ending: ending });
        }
      });
    });
    return matches;
  }

  var TEMPLATE_RE = /(?:을|를)\s*통해[\s\S]{0,45}?(?:역량|태도|인성|리더십|협력|소통|사고\s*력|문제\s*해결\s*능력|창의성|자기주도성)(?:을|를)\s*(?:함양|기르|발전|강화|계발)/g;
  function findTemplateRepeats(text) {
    var matches = findRegexMatches(text, TEMPLATE_RE);
    var count = {};
    matches.forEach(function (m) {
      var key = m.match.replace(/\s+/g, '').slice(0, 20);
      count[key] = (count[key] || 0) + 1;
    });
    return matches.filter(function (m) {
      if (/습관|능력|성질|사고력|이해|지식/.test(m.match)) return false;
      var key = m.match.replace(/\s+/g, '').slice(0, 20);
      return count[key] >= 2 || m.match.length >= 12;
    });
  }

  function classifyEnding(sentence) {
    var s = sentence.replace(/[.!?]+$/, '').trim();
    if (/(?:하였|였|았|었)음$/.test(s)) return 'past';
    if (/(?:함|됨|임|음)$/.test(s)) return 'noun';
    if (/(?:한다|된다|이다|한다\.|된다\.)$/.test(s)) return 'plain';
    if (/(?:함\.|됨\.|임\.|음\.)$/.test(s)) return 'noun';
    return 'other';
  }

  function findEndingInconsistency(text) {
    var sentences = splitSentences(text).filter(function (s) { return s.length >= 8; });
    if (sentences.length < 2) return [];
    var groups = {};
    sentences.forEach(function (s) { var kind = classifyEnding(s); groups[kind] = (groups[kind] || 0) + 1; });
    var kinds = Object.keys(groups).filter(function (k) { return k !== 'other' && groups[k] >= 1; });
    if (kinds.length < 2) return [];
    var dominant = kinds.sort(function (a, b) { return groups[b] - groups[a]; })[0];
    var matches = [];
    sentences.forEach(function (s) {
      var kind = classifyEnding(s);
      if (kind !== 'other' && kind !== dominant) {
        var idx = text.indexOf(s);
        if (idx !== -1) {
          var domLabel = dominant === 'noun' ? '명사형' : (dominant === 'past' ? '과거형' : '평서형');
          matches.push({ start: idx, end: idx + s.length, match: s, label: '종결 형태 혼용 (' + domLabel + ' 위주 권장)' });
        }
      }
    });
    return matches;
  }

  function isNumberComma(text, start) {
    var before = start > 0 ? text[start - 1] : '';
    var after = start + 1 < text.length ? text[start + 1] : '';
    return /\d/.test(before) && /\d/.test(after);
  }

  function findSpacingMatches(text) {
    var rules = [
      { re: /\s{2,}/g, label: '연속 공백' },
      { re: /[가-힣][,，](?=[가-힣A-Za-z0-9])/g, label: '쉼표(,) 뒤 띄어쓰기 없음' },
      { re: /[가-힣]\s+[,，]/g, label: '쉼표(,) 앞 불필요한 공백' },
      { re: /(?<!\d)[,，](?!\d)(?!\s|$|[\n\r])/g, label: '쉼표(,) 뒤 띄어쓰기 없음' },
      { re: /[,，]\s*[,，]/g, label: '쉼표(,) 연속·중복' },
      { re: /[가-힣]\.[가-힣]/g, label: '마침표(.) 뒤 띄어쓰기 없음' },
      { re: /(?<!\d)\.(?=[가-힣A-Za-z0-9])/g, label: '마침표(.) 뒤 띄어쓰기 없음' },
      { re: /[가-힣][：:](?=[가-힣A-Za-z0-9(])/g, label: '콜론(:) 뒤 띄어쓰기 없음' },
      { re: /[가-힣]\s+[：:](?=[\s가-힣A-Za-z0-9])/g, label: '콜론(:) 앞 불필요한 공백' },
      { re: /[:：]\s*[,，]/g, label: '콜론(:) 뒤 쉼표(,) 형식 오류' },
      { re: /[,，]\s*[:：]/g, label: '쉼표(,) 뒤 콜론(:) 형식 오류' },
      { re: /[가-힣]\([가-힣]/g, label: '여는 괄호 앞 띄어쓰기 없음' }
    ];
    var results = [];
    var used = [];
    rules.forEach(function (rule) {
      var flags = rule.re.flags.indexOf('g') === -1 ? rule.re.flags + 'g' : rule.re.flags;
      var regex = new RegExp(rule.re.source, flags);
      var m;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        if ((m[0] === ',' || m[0] === '，') && isNumberComma(text, m.index)) continue;
        if (rule.label === '여는 괄호 앞 띄어쓰기 없음') {
          var openIdx = m.index + 1;
          if (isAllowedParenAfterHangul(text, openIdx)) continue;
        }
        var start = m.index, end = m.index + m[0].length;
        var overlaps = used.some(function (r) { return !(end <= r[0] || start >= r[1]); });
        if (overlaps) continue;
        results.push({ start: start, end: end, match: m[0], label: rule.label });
        used.push([start, end]);
      }
    });
    return results;
  }

  var ACHIEVEMENT_CODE_RE = /\[[0-9]{2}[가-힣]{1,5}[0-9\-]+\]|\([0-9]{2}[가-힣]{1,5}[0-9\-]+\)|[0-9]{2}[가-힣]{2,4}[0-9]{2}-[0-9]{2}-[0-9]{2}/g;
  var MATH_SYMBOL_RE = /[∫∑√∞≤≥±π²³⁴⁵⁶⁷⁸⁹⁰]|\\(?:frac|sqrt|sum|int)|(?:sin|cos|tan|log|lim)\s*[\(\[]/g;

  // ======================================================================
  // §확장 scanExtras(text, profile) — 상위집합(superset). SSOT 코드와 겹치지 않는
  // U(기재금지 추가)/N(NEIS 유의어)/S(문체·형식)/C(진로전공)/M(수학) 접두 코드 사용.
  // ======================================================================
  function scanExtras(text, profile) {
    var out = [];

    findCareerKeywordMatches(text).forEach(function (m) {
      out.push(mk('C1진로전공', 'check', 'm-brown', m.start, m.end, m.match, '진로·전공 직접 언급 의심'));
    });
    findMajorJobMatches(text).forEach(function (m) {
      out.push(mk('C2학과직업', 'check', 'm-brown', m.start, m.end, m.match, '특정 학과·직업명 언급 의심'));
    });

    findKeywordMatches(text, UNIVERSITY_KEYWORDS).forEach(function (m) {
      out.push(mk('U1대학명', 'violation', 'm-red', m.start, m.end, m.match, '특정 대학명 언급'));
    });
    findKeywordMatches(text, ORG_KEYWORDS).forEach(function (m) {
      out.push(mk('U2기관인증', 'violation', 'm-red', m.start, m.end, m.match, '교외 기관·인증시험·대회 언급 의심'));
    });
    findRegexMatches(text, PARENT_JOB_RE).forEach(function (m) {
      out.push(mk('U3부모직업', 'violation', 'm-red', m.start, m.end, ctx(text, m.start, m.end), '부모 신분·직업을 짐작하게 하는 표현 — 기재 불가'));
    });

    findCautionMatches(text).forEach(function (m) {
      out.push(mk('N1기재유의어', 'check', 'm-brown', m.start, m.end, m.match, '기재 유의어 — 대체 표현: 「' + m.alt + '」'));
    });
    findParenRomanizationMatches(text).forEach(function (m) {
      out.push(mk('N2괄호영문', 'check', 'm-brown', m.start, m.end, m.match, '한글 뒤 괄호 영문 표기 — 한글 풀이만 쓰거나 괄호를 제거하세요'));
    });

    findSpeculativeMatches(text).forEach(function (m) {
      out.push(mk('S1추측표현', 'info', 'm-rose', m.start, m.end, m.match, '추측성 표현 — 관찰·평가 사실 위주로 수정 필요'));
    });
    findFloweryMatches(text).forEach(function (m) {
      out.push(mk('S2미사여구', 'info', 'm-amber', m.start, m.end, m.match, m.label));
    });
    findPatternRepeats(text).forEach(function (m) {
      out.push(mk('S3패턴반복', 'info', 'm-violet', m.start, m.end, m.match, '문장 종결 패턴 반복 (…' + m.ending + ')'));
    });
    findTemplateRepeats(text).forEach(function (m) {
      out.push(mk('S4템플릿반복', 'info', 'm-violet', m.start, m.end, m.match, '"~을 통해 ~함양" 등 상투 템플릿 반복'));
    });
    findEndingInconsistency(text).forEach(function (m) {
      out.push(mk('S5종결혼용', 'info', 'm-slate', m.start, m.end, m.match, m.label));
    });
    findSpacingMatches(text).forEach(function (m) {
      out.push(mk('S6띄어쓰기', 'check', 'm-slate', m.start, m.end, m.match, m.label));
    });
    findProcessLack(text).forEach(function (m) {
      out.push(mk('S7과정부족', 'info', 'm-slate', m.start, m.end, m.match, '활동 과정·역할·사고 과정이 드러나는 서술이 부족할 수 있음'));
    });

    if (profile.id === 'math') {
      findRegexMatches(text, ACHIEVEMENT_CODE_RE).forEach(function (m) {
        out.push(mk('M1성취기준코드', 'check', 'm-slate', m.start, m.end, m.match, '성취기준 코드 직접 인용 의심 — 세특에는 직접 인용하지 않습니다'));
      });
      findRegexMatches(text, MATH_SYMBOL_RE).forEach(function (m) {
        out.push(mk('M2수식기호', 'check', 'm-slate', m.start, m.end, m.match, '수식 기호 직접 사용 — 한글로 풀어 쓰세요'));
      });
    }

    return out;
  }

  // 다른 학생과의 문장 중복 — 여러 학생 텍스트를 동시에 봐야 하므로 scan()과 분리된 별도 API.
  // entries: [{id, text}] → { [id]: finding[] }
  function findCrossDuplicates(entries) {
    var list = entries || [];
    var sentenceMap = {};
    list.forEach(function (st) {
      splitSentences(st.text || '').forEach(function (s) {
        var norm = s.replace(/\s+/g, '').replace(/[.!?]+$/, '');
        if (norm.length < 8) return;
        if (!sentenceMap[norm]) sentenceMap[norm] = [];
        sentenceMap[norm].push({ id: st.id, raw: s });
      });
    });
    var dupById = {};
    Object.keys(sentenceMap).forEach(function (key) {
      var group = sentenceMap[key];
      var distinctIds = {};
      group.forEach(function (e) { distinctIds[e.id] = true; });
      if (Object.keys(distinctIds).length < 2) return;
      group.forEach(function (e) {
        var st = list.filter(function (x) { return x.id === e.id; })[0];
        if (!st) return;
        var idx = st.text.indexOf(e.raw);
        if (idx === -1) return;
        if (!dupById[e.id]) dupById[e.id] = [];
        dupById[e.id].push(mk('S8문장중복', 'check', 'm-teal', idx, idx + e.raw.length, e.raw, '다른 학생과 문장 중복'));
      });
    });
    return dupById;
  }

  // ======================================================================
  // 진입점
  // ======================================================================
  function normalizeProfile(profile) {
    if (typeof profile === 'string') return { id: profile, subjectName: '', byteLimit: 1500 };
    profile = profile || {};
    return {
      id: profile.id || 'general',
      subjectName: profile.subjectName || '',
      byteLimit: profile.byteLimit || 1500
    };
  }

  function scan(text, profile) {
    var s = text == null ? '' : String(text);
    var p = normalizeProfile(profile);
    var isForeign = p.id === 'english' || FOREIGN_SUBJECTS.some(function (name) { return p.subjectName.indexOf(name) !== -1; });
    var findings = scanSSOT(s, isForeign, p.byteLimit);
    findings = findings.concat(scanExtras(s, p));
    return findings;
  }

  g.SGB.rulesSubject = {
    scan: scan,
    findCrossDuplicates: findCrossDuplicates,
    byteLenUtf3: byteLenUtf3,
    FOREIGN_SUBJECTS: FOREIGN_SUBJECTS,
    FILE_FORMATS: Object.keys(FILE_FORMATS)
  };
})();
