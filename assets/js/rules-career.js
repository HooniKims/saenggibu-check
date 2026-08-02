/*
 * SGB.rulesCareer — 창체(동아리/진로/자율/행동특성) 점검 규칙
 * 원본: 학교생활기록부 창체점검기.html (읽기 전용 참조본)의 "점검 규칙" 섹션을
 * 동작 그대로 이식한다. 판정 톤은 완화("확인 필요" 위주) — GLOBAL_PROHIBITED(교육부
 * 안내 기재불가 10범주)만 'violation', 나머지는 전부 'check'.
 *
 * 이식에서 제외한 원본 죽은 코드(analyzeAll()에서 전혀 호출되지 않던 코드) — 동작에
 * 영향 없어 포팅하지 않음:
 *   - CAREER_KEYWORDS / CAREER_JIRO_ALLOW / findCareerKeywordMatches
 *   - MAJOR_JOB_REGEX / JOB_EXCLUDE / findMajorJobMatches
 *   - PROCESS_INDICATORS (processWords는 PROFILES별로 실제 사용됨 — 이건 별개의 미사용 상수)
 *   - ACHIEVEMENT_CODE_REGEX / MATH_SYMBOL_REGEX / findSubjectIssues (교과용 훅, 창체 미사용)
 *   - PROFILES.allowCareer 플래그 (위 죽은 CAREER_KEYWORDS 계열을 게이팅하려던 흔적으로 추정,
 *     구조 보존을 위해 데이터 필드는 유지하되 규칙 로직에서는 참조하지 않음 — 원본과 동일)
 *
 * 이중 런타임: 브라우저 / Node(테스트).
 */
(function () {
  'use strict';
  var g = typeof window !== 'undefined' ? window : globalThis;
  g.SGB = g.SGB || {};

  // ====================================================================
  // 활동유형 프로파일 (UI 라벨·NEIS 경로·범례·규칙 파라미터 공용 소스)
  // ====================================================================
  var PROFILES = {
    club: {
      key: 'club',
      label: '동아리활동', byteLimit: 1500, charHint: '약 750자',
      placeholder: '동아리 특기사항을 붙여넣으세요.',
      exportName: '동아리활동_점검결과.xlsx',
      desc: '동아리 활동·역할·탐구 과정 중심. 대회·인증시험·기관명 등은 기재불가 항목입니다.',
      textPatterns: /특기.?사항|동아리.?활동|동아리/,
      textFallback: ['특기사항', '동아리활동', '동아리', '내용'],
      processWords: ['동아리', '활동', '역할', '탐구', '발표', '토론', '참여', '협력', '기획', '운영', '수행', '실험', '조사', '제작', '분석', '토의', '질문', '노력', '개선'],
      neisPath: ['동아리담임', '동아리활동관리', '동아리활동', '학생부 자료기록', '출력(XLS data)'],
      fileExample: '동아리담임 메뉴에서 출력한 XLS 파일(학생 여러 명이 한 시트)',
      uploadNote: '한 파일에 여러 학생이 있어도 성명·번호 기준으로 자동 분리합니다. 이어지는 행의 글도 한 명에게 합칩니다.',
      allowCareer: false, checkCareerLack: false
    },
    career: {
      key: 'career',
      label: '진로활동', byteLimit: 1500, charHint: '약 750자',
      placeholder: '진로활동 특기사항을 붙여넣으세요.',
      exportName: '진로활동_점검결과.xlsx',
      desc: '희망 진로·전공과 연계된 탐색·체험·심화 과정 중심. 진로 연결은 권장, 대회·인증시험 등은 기재불가입니다.',
      textPatterns: /특기.?사항|진로.?활동|진로/,
      textFallback: ['특기사항', '진로활동', '진로', '내용'],
      processWords: ['진로', '탐색', '체험', '희망', '전공', '학과', '직업', '탐구', '분석', '조사', '발표', '질문', '설계', '연계', '구체화', '심화', '관심'],
      neisPath: ['학급담임', '학생생활', '창의적체험활동', '진로활동관리', '학생부 자료기록', '출력(XLS data)'],
      fileExample: '학급담임 → 진로활동관리에서 출력한 XLS 파일',
      uploadNote: '진로활동은 희망 진로·전공과의 연결, 학년별 심화 흐름을 함께 점검합니다.',
      allowCareer: true, checkCareerLack: true
    },
    auto: {
      key: 'auto',
      label: '자율활동', byteLimit: 1500, charHint: '약 750자',
      placeholder: '자율활동 특기사항을 붙여넣으세요.',
      exportName: '자율활동_점검결과.xlsx',
      desc: '학교 교육계획에 따른 자율·학급 활동과 역할 중심. 인성·공동체 역량이 드러나도록 작성합니다.',
      textPatterns: /특기.?사항|자율.?활동|자율/,
      textFallback: ['특기사항', '자율활동', '자율', '내용'],
      processWords: ['자율', '활동', '역할', '학급', '참여', '협력', '기획', '운영', '봉사', '상담', '멘토', '리더', '토의', '토론', '발표', '탐구', '성장', '태도'],
      neisPath: ['학급담임', '학생생활', '창의적체험활동', '자율활동관리', '학생부 자료기록', '출력(XLS data)'],
      fileExample: '학급담임 → 자율활동관리에서 출력한 XLS 파일',
      uploadNote: '1인1역·학급활동 등도 자율활동 특기사항에 기재 가능합니다.',
      allowCareer: false, checkCareerLack: false
    },
    behavior: {
      key: 'behavior',
      label: '행동특성및종합의견', byteLimit: 1500, charLimit: 300, charHint: '약 300자 권고',
      placeholder: '행동특성 및 종합의견을 붙여넣으세요.',
      exportName: '행동특성_점검결과.xlsx',
      desc: '담임 종합의견·행동 특성·성장 과정 중심. 관찰 사실과 균형 잡힌 서술, 진로 연계도 권장됩니다.',
      textPatterns: /행동.?특성|종합.?의견|행동특성및종합의견|행.?특/,
      textFallback: ['행동특성및종합의견', '행동특성', '종합의견', '의견', '내용'],
      processWords: ['성장', '태도', '협력', '리더', '책임', '성실', '배려', '존중', '자율', '적극', '성찰', '공동체', '인성', '소통', '돌봄', '균형', '변화', '모습'],
      neisPath: ['학급담임', '학생생활', '행동특성및종합의견', '학생부 자료기록', '출력(XLS data)'],
      fileExample: '학급담임 → 행동특성및종합의견에서 출력한 XLS 파일',
      uploadNote: '학년별 담임 종합의견·행동특성을 학생별로 자동 분리합니다.',
      allowCareer: true, checkCareerLack: false
    }
  };

  // ====================================================================
  // 상수 (원본 그대로)
  // ====================================================================
  var UNIVERSITY_KEYWORDS = [
    '서울대', '연세대', '고려대', '카이스트', 'KAIST', '포스텍', 'POSTECH', '성균관대', '한양대', '중앙대', '경희대',
    '이화여대', '서강대', '시립대', '건국대', '동국대', '숭실대', '아주대', '인하대', '부산대', '전남대', '전북대', '충남대',
    '경북대', '강원대', '제주대', 'UNIST', 'GIST', 'DGIST', 'UST', '한국외대', '국민대', '홍익대', '숙명여대', '광운대'
  ];
  var ORG_KEYWORDS = [
    '학원', '과외', '사교육', '컨설팅', '멘토링 프로그램', '캠프 참가', '인강', 'EBSi', '메가스터디', '대성마이맥',
    '이투스', '스카이에듀', '올림피아드', '경시대회', 'kmo', 'KMO', '자격증 취득', '인증시험', '교외', '사설',
    '토익', 'TOEIC', '토플', 'TOEFL', '텝스', 'TEPS', 'IELTS', 'SAT', 'AP시험', 'JLPT', 'HSK', '컴활', '정보처리기사',
    '한국사능력검정', '한능검', '실용영어', 'YBM', 'Duolingo', 'K-MOOC', 'MOOC', 'KOCW', '방과후학교', '방과후'
  ];

  // 생기부 기재불가 항목 (교육부·경기도 안내 — 어디에도 기재 불가)
  var GLOBAL_PROHIBITED = [
    { terms: ['TOEIC', 'TOEFL', 'TEPS', 'IELTS', 'HSK', 'JLPT', 'JPT', 'SAT', 'AP시험', '토익', '토플', '텝스', '한능검', '한국사능력검정', '실용영어', '컴활', '정보처리기사'], label: '어학·자격시험 성적·취득 사실 기재 불가' },
    { terms: ['모의고사', '수능', '백분위', '표준점수', '석차', '등급', '전국연합', '학력평가', '원점수'], label: '모의고사·학력평가 성적·석차 기재 불가' },
    { terms: ['소논문', '논문 게재', '논문 발표', '학술지', '학회 발표', '논문을 제출', '논문을 투고'], label: '논문·소논문 작성·게재 사실 기재 불가' },
    { terms: ['특허 출원', '특허 등록', '실용신안', '상표 등록', '디자인 등록', '특허를'], label: '지식재산권 출원·등록 사실 기재 불가' },
    { terms: ['출판하였', '출판한', '간행물', '책을 출간', '도서 출판'], label: '도서 출판 사실 기재 불가' },
    { terms: ['어학연수', '해외 연수', '해외 봉사', '해외 활동', '유학'], label: '해외 연수·활동 사실 기재 불가' },
    { terms: ['장학금', '장학생', '장학재단'], label: '장학금 수혜 사실 기재 불가' },
    { terms: ['부모님 직업', '아버지는', '어머니는', '부모의 직업', '부모 직장'], label: '부모·친인척 신분·직업 관련 기재 불가' },
    { terms: ['우수상', '대상 수상', '금상', '은상', '동상', '입상', '최우수상', '표창', '감사장', '공로상'], label: '대회·행사 수상 사실 기재 불가(수상경력란 제외)' },
    { terms: ['경시대회', '올림피아드', '콘테스트', '대회에서', '대회에 참가', '대회 참가'], label: '교내외 대회 참가·결과 기재 불가' }
  ];

  var GENERIC_PLACEHOLDER = [
    '향후 교육 활동에 적극적으로 참여',
    '역량을 발휘할 수 있는 기회를 갖기를 기대',
    '적극적으로 참여할 것으로 기대',
    '앞으로도 성실히 참여',
    '열심히 활동할 것'
  ];

  var CAREER_LINK_WORDS = ['진로', '희망', '전공', '학과', '직업', '탐색', '체험', '구체화', '연계', '지망', '장래'];

  // NEIS 기재 유의어 → 대체 표현 (교육부 안내 기준)
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

  var CAUTION_FLAT = CAUTION_TERMS.reduce(function (acc, entry) {
    entry.terms.forEach(function (term) { acc.push({ term: term, alt: entry.alt, boundary: !!entry.boundary }); });
    return acc;
  }, []).sort(function (a, b) { return b.term.length - a.term.length; });

  var FLOWERY_SEVERE = [
    '매우 우수', '매우 뛰어난', '발군의', '최고의', '엄청난', '압도적', '최상의', '최우수', '눈부신', '대단히'
  ];
  var FLOWERY_MILD = [
    '정말로', '탁월한', '탁월함', '뛰어난 역량', '완벽하게', '굉장히',
    '우수함', '우수한', '훌륭함', '훌륭한', '탁월하게', '뛰어난'
  ];
  var SPECULATIVE_REGEX = /(?:것\s*같(?:음|다|으며|고|아|아서|은)?|(?:으로|로)\s*보(?:이(?:는|며|나|고|아)?|여|인)|(?<![가-힣])아마(?:도)?(?![가-힣])|추정(?:하(?:는|였|여|며|나)?|됨|되)|추측(?:하(?:는|였|여|며|나)?|됨|되)|(?:할|될)\s*것(?:으로|같)|인\s*듯(?:하(?:다|며|나|고|아)?|함)?|(?:~|\.\.\.)?(?:라\s*)?고\s*짐작)/g;
  var TEMPLATE_REGEX = /(?:을|를)\s*통해[\s\S]{0,45}?(?:역량|태도|인성|리더십|협력|소통|사고\s*력|문제\s*해결\s*능력|창의성|자기주도성)(?:을|를)\s*(?:함양|기르|발전|강화|계발)/g;

  function isNumberComma(text, start) {
    var before = start > 0 ? text[start - 1] : '';
    var after = start + 1 < text.length ? text[start + 1] : '';
    return /\d/.test(before) && /\d/.test(after);
  }

  function findSpeculativeMatches(text) {
    var academicBefore = /(?:값|수치|수|량|크기|넓이|부피|적분|미분|함수|그래프|데이터|통계|근|계수|오차|면적|확률|농도|온도|속도)\s*(?:을|를)?\s*$/;
    return findRegexMatches(text, SPECULATIVE_REGEX).filter(function (m) {
      if (!/^추정/.test(m.match)) return true;
      var before = text.slice(Math.max(0, m.start - 20), m.start);
      var after = text.slice(m.start, Math.min(text.length, m.end + 20));
      if (academicBefore.test(before)) return false;
      if (/^추정(?:하(?:는|였|여|며|나)?|하여|해)?\s*(?:탐구|보고서|실험|과제|활동|방법|과정|식|공식|값|근사)/.test(after)) return false;
      return true;
    });
  }

  function isAllowedParenAfterHangul(text, parenIndex) {
    var closeIdx = text.indexOf(')', parenIndex);
    if (closeIdx === -1 || closeIdx - parenIndex > 120) return false;
    var inner = text.slice(parenIndex + 1, closeIdx).trim();
    if (!inner || inner.length > 120) return false;
    if (/^[A-Za-z][A-Za-z0-9\-]{0,30}$/.test(inner)) return false;
    return true;
  }

  var PAREN_ROMANIZATION_REGEX = /[가-힣]{1,20}\(([A-Za-z][A-Za-z0-9\-]{1,30})\)/g;
  var PAREN_ROMAN_ACRONYM = { DNA: 1, RNA: 1, AI: 1, VR: 1, AR: 1, AP: 1, IT: 1, PC: 1, TV: 1, CD: 1, GDP: 1, WHO: 1, UN: 1, EU: 1 };

  function findParenRomanizationMatches(text) {
    return findRegexMatches(text, PAREN_ROMANIZATION_REGEX).filter(function (m) {
      var mm = m.match.match(/\(([A-Za-z][A-Za-z0-9\-]{1,30})\)/);
      var inner = mm ? mm[1] : null;
      if (!inner) return false;
      if (PAREN_ROMAN_ACRONYM[inner.toUpperCase()]) return false;
      if (/^[A-Z]{2,5}$/.test(inner)) return false;
      return true;
    }).map(function (m) {
      return { start: m.start, end: m.end, match: m.match, label: '한글 뒤 괄호 영문 표기 — 한글 풀이만 쓰거나 괄호를 제거하세요' };
    });
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
      var regex = new RegExp(rule.re.source, rule.re.flags.indexOf('g') !== -1 ? rule.re.flags : rule.re.flags + 'g');
      var m;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        if ((m[0] === ',' || m[0] === '，') && isNumberComma(text, m.index)) continue;
        if (rule.label === '여는 괄호 앞 띄어쓰기 없음') {
          var openIdx = m.index + 1;
          if (isAllowedParenAfterHangul(text, openIdx)) continue;
        }
        var start = m.index;
        var end = m.index + m[0].length;
        var overlaps = used.some(function (pair) { return !(end <= pair[0] || start >= pair[1]); });
        if (overlaps) continue;
        results.push({ start: start, end: end, match: m[0], label: rule.label });
        used.push([start, end]);
      }
    });

    return results;
  }

  function findGlobalProhibitedMatches(text) {
    var matches = [];
    GLOBAL_PROHIBITED.forEach(function (entry) {
      findKeywordMatches(text, entry.terms).forEach(function (m) {
        matches.push({ start: m.start, end: m.end, match: m.match, label: entry.label });
      });
    });
    return matches;
  }

  function findGenericPlaceholderMatches(text) {
    return findKeywordMatches(text, GENERIC_PLACEHOLDER).map(function (m) {
      return { start: m.start, end: m.end, match: m.match, label: '형식적·기대 표현 — 구체적 활동·역할·과정으로 바꿔보세요' };
    });
  }

  function findCareerLack(text) {
    if (text.trim().length < 40) return [];
    if (CAREER_LINK_WORDS.some(function (w) { return text.indexOf(w) !== -1; })) return [];
    return [{ start: 0, end: Math.min(text.length, 40), match: text.slice(0, 40), label: '진로·전공·탐색과의 연결이 드러나지 않을 수 있음' }];
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
        var overlaps = used.some(function (pair) { return !(end <= pair[0] || found >= pair[1]); });
        if (!overlaps) {
          results.push({ start: found, end: end, match: kw });
          used.push([found, end]);
        }
        idx = found + 1;
      }
    });
    return results;
  }

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
      if (n >= 2) {
        matches.push({ start: m.start, end: m.end, match: m.match, label: '"' + m.match + '" ' + n + '회 반복 — 미사여구 남발 의심' });
      }
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

  function findRegexMatches(text, regex, label) {
    var results = [];
    var re = new RegExp(regex.source, regex.flags.indexOf('g') !== -1 ? regex.flags : regex.flags + 'g');
    var m;
    while ((m = re.exec(text)) !== null) {
      results.push({ start: m.index, end: m.index + m[0].length, match: m[0], label: label });
      if (m[0].length === 0) re.lastIndex++;
    }
    return results;
  }

  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
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

  function findTemplateRepeats(text) {
    var matches = findRegexMatches(text, TEMPLATE_REGEX, '상투 템플릿');
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
    sentences.forEach(function (s) {
      var kind = classifyEnding(s);
      groups[kind] = (groups[kind] || 0) + 1;
    });
    var kinds = Object.keys(groups).filter(function (k) { return k !== 'other' && groups[k] >= 1; });
    if (kinds.length < 2) return [];
    var dominant = kinds.sort(function (a, b) { return groups[b] - groups[a]; })[0];
    var matches = [];
    sentences.forEach(function (s) {
      var kind = classifyEnding(s);
      if (kind !== 'other' && kind !== dominant) {
        var idx = text.indexOf(s);
        if (idx !== -1) {
          matches.push({
            start: idx, end: idx + s.length, match: s,
            label: '종결 형태 혼용 (' + (dominant === 'noun' ? '명사형' : dominant === 'past' ? '과거형' : '평서형') + ' 위주 권장)'
          });
        }
      }
    });
    return matches;
  }

  function findProcessLack(text, profile) {
    if (text.trim().length < 60) return [];
    var words = (profile && profile.processWords) || [];
    if (words.some(function (w) { return text.indexOf(w) !== -1; })) return [];
    return [{ start: 0, end: Math.min(text.length, 40), match: text.slice(0, 40), label: '활동 과정·역할·사고 과정이 드러나는 서술이 부족할 수 있음' }];
  }

  // 다른 학생과의 문장 중복 — 전 학생 텍스트를 함께 봐야 하므로 scan(단일 텍스트)과
  // 별도 함수로 노출한다. students: [{id, text}]
  function findCrossDuplicates(students) {
    var sentenceMap = {};
    (students || []).forEach(function (st) {
      var sentences = splitSentences(st.text || '');
      sentences.forEach(function (s) {
        var norm = s.replace(/\s+/g, '').replace(/[.!?]+$/, '');
        if (norm.length < 8) return;
        if (!sentenceMap[norm]) sentenceMap[norm] = [];
        sentenceMap[norm].push({ studentId: st.id, raw: s });
      });
    });
    var dupByStudent = {};
    Object.keys(sentenceMap).forEach(function (norm) {
      var entries = sentenceMap[norm];
      var distinctStudents = {};
      entries.forEach(function (e) { distinctStudents[e.studentId] = true; });
      if (Object.keys(distinctStudents).length >= 2) {
        entries.forEach(function (e) {
          var st = (students || []).filter(function (s) { return s.id === e.studentId; })[0];
          if (!st) return;
          var idx = (st.text || '').indexOf(e.raw);
          if (idx !== -1) {
            if (!dupByStudent[e.studentId]) dupByStudent[e.studentId] = [];
            dupByStudent[e.studentId].push({ start: idx, end: idx + e.raw.length, match: e.raw });
          }
        });
      }
    });
    return dupByStudent;
  }

  // ====================================================================
  // §2b 계약: SGB.rulesCareer.scan(text, profile) → findings[]
  // finding: {rule, grade:'violation'|'check'|'info', span:[s,e], quote, note, color}
  // 톤: GLOBAL_PROHIBITED만 violation(m-red), 나머지 전부 check(그 외 6색).
  // ====================================================================
  function scan(text, profile) {
    var s = text == null ? '' : String(text);
    var p = profile || PROFILES.club;
    var findings = [];

    function add(rule, grade, m, note, color) {
      findings.push({ rule: rule, grade: grade, span: [m.start, m.end], quote: m.match, note: note, color: color });
    }

    findGlobalProhibitedMatches(s).forEach(function (m) { add('PROHIBITED', 'violation', m, m.label, 'm-red'); });
    findKeywordMatches(s, UNIVERSITY_KEYWORDS).forEach(function (m) { add('ORG', 'check', m, '특정 대학명 언급 — 기관명 기재 유의', 'm-brown'); });
    findKeywordMatches(s, ORG_KEYWORDS).forEach(function (m) { add('ORG', 'check', m, '교외 기관·인증시험·대회·사교육 언급 의심', 'm-brown'); });
    findCautionTermMatches(s).forEach(function (m) { add('CAUTION', 'check', m, m.label, 'm-brown'); });
    findRegexMatches(s, /[‘’“”]/g).forEach(function (m) {
      add('QUOTE', 'check', m, "굽은 따옴표 — 곧은 작은따옴표(') 권장, 관례 확인 필요", 'm-brown');
    });
    findRegexMatches(s, /[·‧ㆍ]/g).forEach(function (m) {
      add('MIDDOT', 'check', m, '가운뎃점 — 조사·연결어미로 풀어쓰기 권장, 관례 확인 필요', 'm-brown');
    });
    findParenRomanizationMatches(s).forEach(function (m) { add('PARENROMAN', 'check', m, m.label, 'm-brown'); });
    findGenericPlaceholderMatches(s).forEach(function (m) { add('PLACEHOLDER', 'check', m, m.label, 'm-amber'); });

    if (p.checkCareerLack) {
      findCareerLack(s).forEach(function (m) { add('CAREER_LACK', 'check', m, m.label, 'm-rose'); });
    }

    findSpeculativeMatches(s).forEach(function (m) { add('SPECULATIVE', 'check', m, '추측성 표현 — 관찰·평가 사실 위주로 수정 필요', 'm-rose'); });
    findProcessLack(s, p).forEach(function (m) { add('PROCESS_LACK', 'check', m, m.label, 'm-rose'); });
    findFloweryMatches(s).forEach(function (m) { add('FLOWERY', 'check', m, m.label, 'm-amber'); });
    findPatternRepeats(s).forEach(function (m) { add('PATTERN', 'check', m, '문장 종결 패턴 반복 (…' + m.ending + ')', 'm-violet'); });
    findTemplateRepeats(s).forEach(function (m) { add('TEMPLATE', 'check', m, '"~을 통해 ~함양" 등 상투 템플릿 반복', 'm-violet'); });
    findEndingInconsistency(s).forEach(function (m) { add('ENDING', 'check', m, m.label, 'm-slate'); });
    findSpacingMatches(s).forEach(function (m) { add('SPACING', 'check', m, m.label || '띄어쓰기·구두점 형식 점검 필요', 'm-slate'); });

    return findings;
  }

  // findCautionMatches 원본 이식 (escapeRegex/hasWordBoundary 포함)
  function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function hasWordBoundary(text, start, end) {
    var before = start > 0 ? text[start - 1] : '';
    var after = end < text.length ? text[end] : '';
    if (/[가-힣]/.test(before) || /[가-힣]/.test(after)) return false;
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return false;
    return true;
  }
  function findCautionTermMatches(text) {
    var results = [];
    var used = [];
    var lower = text.toLowerCase();

    CAUTION_FLAT.forEach(function (entry) {
      var term = entry.term, alt = entry.alt, boundary = entry.boundary;
      var q = term.toLowerCase();
      var needBoundary = boundary || term.length <= 2 || (/^[가-힣]+$/.test(term) && term.length <= 3);
      var idx = 0;
      while (idx < text.length) {
        var found = -1;
        var matchLen = term.length;

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
        var overlaps = used.some(function (pair) { return !(end <= pair[0] || found >= pair[1]); });
        if (!overlaps) {
          results.push({
            start: found, end: end, match: text.slice(found, end), alt: alt,
            label: '기재 유의어 — 대체 표현: 「' + alt + '」'
          });
          used.push([found, end]);
        }
      }
    });
    return results;
  }

  g.SGB.rulesCareer = {
    PROFILES: PROFILES,
    scan: scan,
    findCrossDuplicates: findCrossDuplicates,
    // 디버깅/테스트 편의 노출(계약 외)
    _internal: {
      GLOBAL_PROHIBITED: GLOBAL_PROHIBITED,
      UNIVERSITY_KEYWORDS: UNIVERSITY_KEYWORDS,
      ORG_KEYWORDS: ORG_KEYWORDS,
      CAUTION_TERMS: CAUTION_TERMS,
      findCautionTermMatches: findCautionTermMatches,
      findSpeculativeMatches: findSpeculativeMatches,
      findSpacingMatches: findSpacingMatches
    }
  };
})();
