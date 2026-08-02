# 핵심 로직 문서 — 생기부 점검 허브

> 나중에 직접 고칠 수 있게 쓴 문서입니다. "무엇이 어디에 있고, 뭘 바꾸면 뭐가 달라지는지"가 중심입니다.
> 규칙 키워드만 추가하고 싶다면 [§8 자주 하는 수정 레시피](#8-자주-하는-수정-레시피)로 바로 가세요.

**문서 기준일:** 2026-08-02 · 줄 번호는 이 저장소의 현재 파일 기준입니다.

---

## 목차

1. [전체 그림](#1-전체-그림)
2. [파일 지도](#2-파일-지도)
3. [바이트 계산 — 교과와 창체가 다르다](#3-바이트-계산--교과와-창체가-다르다)
4. [NEIS 엑셀 파서](#4-neis-엑셀-파서)
5. [교과세특 규칙 전수표](#5-교과세특-규칙-전수표)
6. [창체·행특 규칙 전수표](#6-창체행특-규칙-전수표)
7. [렌더링 · 색 체계](#7-렌더링--색-체계)
8. [자주 하는 수정 레시피](#8-자주-하는-수정-레시피)
9. [알려진 이슈 · 원본 대비 변경점](#9-알려진-이슈--원본-대비-변경점)

---

## 1. 전체 그림

서버가 없습니다. 정적 HTML/CSS/JS뿐이고 **학생 데이터는 브라우저 밖으로 나가지 않습니다**. 엑셀 파싱도, 규칙 판정도, 엑셀 생성도 전부 탭 안에서 끝납니다.

```
 엑셀 업로드 (.xlsx)
   │
   ├─ FileReader → ArrayBuffer
   │
   ▼
 [1] 파싱          SGB.parse.parseWorkbook()          xlsx-parse.js
   │                 · 포맷 자동 감지 (표준 / 인쇄덤프)
   │                 · 과목명 잘림 보정
   ▼
 [2] 병합          SGB.parse.mergeStudents()          xlsx-parse.js
   │                 · 키 = 번호|성명, 여러 파일 누적
   ▼
 [3] 판정          SGB.rulesSubject.scan()            rules-subject.js
   │               SGB.rulesCareer.scan()             rules-career.js
   │                 · 텍스트 1개 → findings[] 반환
   │                 · 학생 간 문장 중복은 findCrossDuplicates()로 별도
   ▼
 [4] 렌더          SGB.core.buildAnnotatedHtml()      checker-core.js
   │               SGB.core.renderGauge()
   │                 · findings의 span → <mark class="m-*">
   ▼
 [5] 내보내기      SGB.exporter.*                     export.js
                     · xlsx 요약 / 과목별 zip / 클립보드
```

**핵심 자료구조는 딱 두 개입니다.**

```js
// 학생 — 교과세특은 학생 1명이 과목 여러 개(entries)를 가진다
{ id: 1, no: '3/1', name: '김서연',
  entries: [ { subject: '국어', text: '...' },
             { subject: '수학', text: '...' } ] }

// finding — 모든 규칙이 이 모양으로 반환한다
{ rule:  'R3과거시제',        // 내부 코드. 화면 표시는 RULE_LABELS가 번역
  grade: 'violation',         // violation | check | info
  span:  [12, 16],            // text 안의 문자 인덱스 [시작, 끝)
  quote: '정리했고',           // 이슈 목록에 인용될 조각
  note:  "과거형 음절 '했'",   // 사람이 읽을 설명
  color: 'm-red' }            // 형광펜 클래스 (§7)
```

`grade`와 `color`는 **독립**입니다. `grade`는 "확정 위반만 보기" 필터가 쓰고, `color`는 형광펜 색을 정합니다. 같은 `grade`라도 색이 다를 수 있습니다.

---

## 2. 파일 지도

| 파일 | 줄수 | 역할 | 언제 여나 |
|---|---:|---|---|
| `assets/js/checker-core.js` | 165 | 바이트 계산, HTML 이스케이프, 하이라이트 조립, 게이지, localStorage, 토스트 | 공용 유틸을 고칠 때 |
| `assets/js/xlsx-parse.js` | 513 | NEIS 엑셀 2포맷 파서 + 학생 병합 | 엑셀이 안 읽힐 때 |
| `assets/js/rules-subject.js` | 742 | **교과세특 규칙 전체** | 교과 규칙을 고칠 때 |
| `assets/js/rules-career.js` | 591 | **창체·행특 규칙 전체 + 활동유형 4종 프로파일** | 창체 규칙을 고칠 때 |
| `assets/js/export.js` | 155 | xlsx / zip / 클립보드 내보내기 | 내보내기 컬럼을 바꿀 때 |
| `assets/js/subject-app.js` | 866 | subject.html 화면 제어 | 교과 화면 UI를 고칠 때 |
| `assets/js/career-app.js` | 860 | career.html 화면 제어 | 창체 화면 UI를 고칠 때 |

로드 순서가 곧 의존 순서입니다 (HTML 하단 `<script>` 참조). 벤더(SheetJS, JSZip) → `checker-core` → `xlsx-parse` → `export` → `rules-*` → `*-app`. **이 순서를 바꾸면 깨집니다.**

모든 모듈은 `window.SGB.*` 하나에만 붙습니다. 전역 오염이 `SGB` 한 개로 끝납니다.

> **이중 런타임:** 모듈들은 브라우저와 Node 양쪽에서 동작하도록 작성돼 있습니다(`var g = typeof window !== 'undefined' ? window : globalThis`). DOM이 없으면 DOM 함수는 조용히 no-op 합니다. 덕분에 규칙 테스트를 브라우저 없이 Node로 돌릴 수 있습니다 — [§8.7](#87-규칙을-node로-테스트하기) 참조.

---

## 3. 바이트 계산 — 교과와 창체가 다르다

**이 문서에서 가장 헷갈리기 쉬운 부분입니다.** 같은 글자인데 페이지마다 바이트 수가 다르게 나옵니다. 버그가 아니라 의도된 것입니다.

`checker-core.js:18` `byteLen(text, mode)`

| mode | 한글 1자 | 쓰는 곳 | 근거 |
|---|---:|---|---|
| `'utf3'` | **3바이트** | 교과세특 (`subject-app.js`) | 실제 UTF-8 인코딩 |
| `'neis2'` | **2바이트** | 창체·행특 (`career-app.js`) | NEIS 레거시(EUC-KR) 관행 |

```
"가나다" → utf3: 9B   /   neis2: 6B
```

ASCII는 두 모드 모두 1바이트입니다. 서로게이트 쌍(이모지 등)도 보정합니다.

**주의:** `rules-subject.js:48`에 `byteLenUtf3()`가 **한 번 더** 독립 구현돼 있습니다. 로드 순서에 의존하지 않으려는 의도인데, 결과적으로 **바이트 계산 로직이 두 군데** 있습니다. R10(분량 초과) 기준을 바꾸려면 둘 다 고쳐야 합니다.

기본 제한은 1,500바이트이고 화면의 "바이트 제한" 입력으로 바꿀 수 있습니다. 행동특성·종합의견만 글자수 권고 300자가 추가로 붙습니다 (`rules-career.js:71` `charLimit: 300`).

---

## 4. NEIS 엑셀 파서

`xlsx-parse.js` — NEIS가 뱉는 두 가지 엑셀 형태를 자동으로 구분합니다.

### 4.1 포맷 감지 (`:71` `detectFormat`)

앞 60행을 훑어 **인쇄덤프 헤더행**이 있으면 `printdump`, 없으면 `standard`.

인쇄덤프 헤더행의 조건 (`:62` `isPrintDumpHeaderRow`):
- `과목`과 `성명`이 **둘 다** 있고,
- `반/번호`·`학년도`·`학생개인번호`·`과목코드` 중 **아무것도 없어야** 함 (`:60` `STD_GRID_ONLY_MARKERS`)

표준 양식도 `과목`+`성명`을 가지므로, 표준 양식에만 있는 열 이름을 배제 조건으로 씁니다.

### 4.2 표준 그리드 (`:412` `parseStandard`)

NEIS 업로드용 격자 양식입니다. 헤더행을 찾아 열 인덱스를 잡습니다 (`:278` `findColumnIndices`, 앞 50행 스캔).

번호 열은 4가지 형태를 순서대로 시도합니다:

| 우선순위 | `noMode` | 인식 조건 | 결과 |
|---:|---|---|---|
| 1 | `slash` | `반/번호` 열 | `"3/1"` |
| 2 | `ban_beon` | `반` + `번호` 두 열 | `"3-1"` |
| 3 | `hakbun` | `학번`/`출석번호`/`연번` | 그대로 |
| 4 | `beon` | `번호`만 | 그대로 |
| 5 | `none` | 없음 | `""` |

헤더를 못 찾으면 **휴리스틱 추측**으로 넘어갑니다 (`:315` `guessColumnIndices`) — 앞 80행에서 "2~4자 한글 = 성명", "40자 이상 = 본문"으로 찍습니다. 최후의 수단이라 오탐이 있을 수 있습니다.

과목명은 파일 안의 `과목` 열이 최우선이고, 없으면 파일명에서 뽑습니다 (`:399` `extractSubjectFromFileName`). `과목` 열이 병합셀이라 비어 있으면 **forward-fill** 합니다 (`:380`).

> **알아둘 것:** `parseStandard`는 **엑셀 행 하나당 학생 객체 하나**를 만듭니다. 같은 학생이 과목 2개면 유사학생 2개가 나옵니다. 이걸 실제 학생 단위로 합치는 건 다음 단계인 `mergeStudents`입니다. 두 함수를 세트로 봐야 합니다.

### 4.3 인쇄덤프 (`:115` `parsePrintDump`)

NEIS 인쇄 출력을 긁어온 형태입니다. 페이지마다 헤더가 다시 나오고, 긴 세특은 여러 행에 걸쳐 잘려 있습니다.

처리 규칙:

- **헤더행 재등장** → 열 인덱스를 다시 잡고 건너뜀
- **학급행** (`3학년 3반` 패턴, `:81` `CLASS_ROW_RE`) → `sourceLabel`로 보존
- **노이즈행** 제거 → `사용자명`, `2025.03.02.` 날짜, `학교생활기록부`, `1 / 2` 페이지 푸터
- **성명이 있는 행** → 새 학생 시작. 과목 칸이 비었으면 직전 과목을 이어씀(forward-fill)
- **성명이 빈 행 + 본문 있음** → 직전 학생 세특에 공백 하나로 이어붙임
- **페이지 경계 중복 방어** → 같은 학생·같은 과목이 연달아 나오면 새 항목 대신 텍스트만 이어붙임 (`:179`)

### 4.4 과목명 잘림 보정 (`:201` `finalizeSubjects`)

인쇄덤프에서 과목명이 열 너비에 잘리는 문제를 고칩니다.

```
'통합사회' 와 '통합사회탐구' 가 둘 다 등장
  → '통합사회'는 '통합사회탐구'의 접두사
  → 짧은 쪽을 긴 쪽으로 통합
```

**두 개 이상의 긴 이름의 접두사가 되면(모호하면) 보정하지 않습니다** (`:212` `ambiguous`). 예를 들어 `통합사회탐구`와 `통합사회문화`가 같이 있으면 `통합사회`는 그냥 둡니다. 잘못 합치는 것보다 안전하다는 판단입니다.

보정된 과목은 결과 화면에 `표기 보정됨` 배지로 표시됩니다.

### 4.5 학생 병합 (`:466` `mergeStudents`)

- **키:** `공백제거(번호) + '|' + 성명`
- 같은 학생에 **없는 과목**이면 `entries`에 추가
- 같은 학생에 **이미 있는 과목**이면 **최신 내용으로 교체**하고 `replacedCount++` → 화면에 "중복 과목 파일 감지 — 최신 내용으로 교체됨" 토스트

여러 파일을 한 번에 올리거나 같은 파일을 다시 올릴 때 이 경로를 탑니다.

### 4.6 창체 전용 파서 (`career-app.js`)

창체에는 `SGB.parse`가 모르는 형태가 하나 더 있어 `career-app.js`가 자체 처리합니다.

- `:317` `detectActivityTypeFromRows` — 앞 10행에서 `동아리활동`/`진로활동`/`자율활동`/`행동특성` 문구를 찾아 **탭을 자동 전환**
- `:377` `parseCareerBundleRows` — "진로활동 + 학생부" 묶음 양식 전용. 본문은 4번째 열 고정, `희망분야`는 `[희망분야: ...]`로 앞에 붙임
- 그 외 형태는 `SGB.parse.parseWorkbook`에 위임하고 `entries`를 하나의 문자열로 이어붙임

---

## 5. 교과세특 규칙 전수표

`rules-subject.js` · 진입점 `scan(text, profile)` (`:726`)

`profile`은 `{ id, subjectName, byteLimit }`입니다. `id`는 `general` | `math` | `science` | `english`.

**외국어 판정** (`:729`): `id === 'english'` 이거나 과목명에 외국어 교과명(`영어`·`일본어`·`중국어` 등)이 들어가면 알파벳·가나가 위반이 아니라 "확인 필요"로 완화됩니다 (`:93` `FOREIGN_SUBJECTS`).

### 5.1 SSOT 규칙 R1~R10 · F1 · F2 (`:155` `scanSSOT`)

> 원본 주석에 따르면 이 블록은 별도의 파이썬 스크립트(`rule_scan.py`)와 **정확히 일치해야 하는** 부분입니다. 그 스크립트는 이 저장소에 없지만, 규칙을 바꿀 땐 원저자와 동기화가 필요할 수 있다는 점을 기억하세요.

| 코드 | 화면 라벨 | 등급 | 색 | 무엇을 잡나 | 예외 | 상수 |
|---|---|---|---|---|---|---|
| **R1알파벳** | 영문·외국어 표기 | violation | `m-red` | 알파벳 `[A-Za-z]+`, 일본어 가나 | 외국어 과목이면 F1로 강등 | — |
| **R2특수기호** | 특수기호 | violation | `m-red` | `· / ~ - : ; * ∼ ‧ ㆍ` | `능력단위:` 쌍점만 면제 | `:183` |
| **R3과거시제** | 과거형 표현 | violation | `m-red` | `았/었/였` 음절, ㅆ받침 축약(했·갔·됐…) | `겠` 제외 · **작은따옴표 안(도서명) 제외** · `~다고/다는/다며` 뒤따르면 check로 완화 | `:131` `isPastContraction` |
| " | " | check | `m-brown` | `~던` 회상형 | 어간 일부일 수 있어 확인 등급 | `:206` |
| **R4내면심리** | 내면·심리 서술 | info | `m-rose` | 느꼈·깨달·다짐·자부심 등 30개 | — | `:99` `MIND_WORDS` |
| **R5역량어단독** | 근거 없는 역량어 | info | `m-rose` | `탐구력이 뛰어남` 류 (역량어+평가어) | — | `:106` `COMPETENCY_RE` |
| **R6지칭어** | 인물 지칭 | check | `m-brown` | `학생은/이`, `그는`, `그녀는`, `본인은/이` | 합성어 오탐 가능 | `:107` `PRONOUN_RE` |
| **R7기재금지** | 기재불가 항목 | violation | `m-red` | 대학명, 어학시험·급수, 소논문, 교외 수상 | — | `:108` `BANNED_ITEMS` |
| **R8무관내용** | 성취기준 무관 | check | `m-brown` | 맞춤법, 글씨, 출결, 분량 언급 | — | `:114` `IRRELEVANT` |
| **R9줄바꿈도서명** | 줄바꿈·따옴표 표기 | violation | `m-red` | 줄바꿈, `『』「」《》〈〉`, 굽은 따옴표, **작은따옴표 홀수 개** | — | `:243` |
| **R10분량** | 분량 초과 | violation | `m-red` | 바이트 초과 (기본 1500B, utf3) | — | `:258` |
| **F1외국어확인** | 원어 표기 (확인 필요) | check | `m-brown` | 외국어 과목의 알파벳·가나 | — | — |
| **F2파일형식확인** | 파일 형식 (확인 필요) | check | `m-brown` | `GIF JPG JPEG PNG PDF SVG PSD MP4` | 과목 무관, 항상 check | `:97` |

> **R10의 span은 `[0,0]`입니다.** 문단 전체를 하이라이트하면 다른 표시를 다 덮어버려서, 게이지가 이미 초과를 보여주니 span은 0폭으로 두고 이슈 목록에만 남깁니다 (`:261` 주석).

### 5.2 확장 규칙 (`:621` `scanExtras`)

SSOT 판정과 겹치지 않도록 별도 접두 코드를 씁니다. **C**=진로전공, **U**=기재금지 추가, **N**=NEIS 유의어, **S**=문체·형식, **M**=수학 전용.

| 코드 | 화면 라벨 | 등급 | 색 | 무엇을 잡나 | 상수 |
|---|---|---|---|---|---|
| **C1진로전공** | 진로·전공 언급 (확인 필요) | check | `m-brown` | 장래희망, 진학을 희망, 졸업 후 등 | `:273` |
| **C2학과직업** | 학과·직업명 언급 (확인 필요) | check | `m-brown` | `○○학과/학부/전공/계열`, 의사·변호사 등 | `:291` |
| **U1대학명** | 대학명 언급 | violation | `m-red` | 서울대·연세대·KAIST 등 34개 | `:280` |
| **U2기관인증** | 교외 기관·인증시험 언급 | violation | `m-red` | 학원·과외·토익·올림피아드 등 | `:285` |
| **U3부모직업** | 부모 직업 암시 (기재불가) | violation | `m-red` | `아버지는`, `부모님 직업` 등 | `:291` |
| **N1기재유의어** | 기재 유의어 | check | `m-brown` | 상표·서비스명 → 대체 표현 제안 (약 120개) | `:293` |
| **N2괄호영문** | 괄호 안 영문 표기 | check | `m-brown` | `한글(English)` | `:437` |
| **S1추측표현** | 추측성 표현 | info | `m-rose` | `~것 같음`, `~로 보임`, 추정·짐작 | `:471` |
| **S2미사여구** | 미사여구 | info | `m-amber` | 최상급 표현 / 같은 말 2회 이상 / 총 4회 이상 | `:478` |
| **S3패턴반복** | 문장 패턴 반복 | info | `m-violet` | 끝 8자가 같은 문장 2개 이상 | `:503` |
| **S4템플릿반복** | 상투적 템플릿 반복 | info | `m-violet` | `~을 통해 ~역량을 함양` 류 | `:499` |
| **S5종결혼용** | 문장 종결 혼용 | info | `m-slate` | 명사형/과거형/평서형 섞임 → 다수파 아닌 쪽 표시 | `:539` |
| **S6띄어쓰기** | 띄어쓰기·표기 오류 | check | `m-slate` | 연속 공백, 쉼표·마침표·콜론 앞뒤 12종 | `:576` |
| **S7과정부족** | 과정·역할 서술 부족 | info | `m-slate` | 60자 이상인데 과정 어휘가 하나도 없음 | `:471` |
| **S8문장중복** | 문장 중복 | check | `m-teal` | **다른 학생과** 같은 문장 | `:684` |
| **M1성취기준코드** | 성취기준 코드 직접 인용 | check | `m-slate` | `[12수학01-03]` 류 — **`math` 프로파일 전용** | `:614` |
| **M2수식기호** | 수식 기호 직접 사용 | check | `m-slate` | `∫ ∑ √ ≤ π`, `\frac`, `sin(` — **`math` 전용** | `:615` |

**S8만 호출 방식이 다릅니다.** 다른 학생 텍스트를 동시에 봐야 하므로 `scan()`이 아니라 `findCrossDuplicates(entries)`를 따로 부릅니다 (`subject-app.js:443`). 8자 미만 문장은 무시하고, 과목 그룹 안에서만 비교합니다.

### 5.3 오탐 방지 장치

원본이 공들인 부분이라 건드릴 때 주의가 필요합니다.

- **`의사`** (`:419`) — `의사 전달/표현/소통/결정`이면 직업이 아니므로 제외. `자신의 의사`도 제외
- **`기자`** (`:426`) — 뒤에 `동차/재/망/석`이 오면 `자동차·기자재·기자망·기자석`이므로 제외
- **`추정`** (`:460`) — 앞에 `값·함수·확률·오차` 등 학술어가 오면 추측이 아니라 학술 용어이므로 제외
- **약어 경계** (`:360` `hasWordBoundary`) — `UN`, `VR` 같은 2글자 약어는 앞뒤가 한글/영숫자면 매칭 안 함. `RUN`에서 `UN`을 잡지 않기 위함
- **괄호 안 로마자** (`:439`) — `DNA`, `AI` 등 표준 약어와 전부 대문자(2~5자)는 제외

---

## 6. 창체·행특 규칙 전수표

`rules-career.js` · 진입점 `scan(text, profile)` (`:486`)

**판정 톤이 교과보다 완화돼 있습니다.** 교육부 기재불가 10범주만 `violation`이고 **나머지는 전부 `check`** 입니다. 교과에서 `violation`인 대학명도 여기선 `check`입니다.

### 6.1 활동유형 프로파일 4종 (`:26` `PROFILES`)

| 키 | 라벨 | 바이트 | 글자 권고 | 진로연계 검사 | NEIS 경로 |
|---|---|---:|---|:---:|---|
| `club` | 동아리활동 | 1500 | 약 750자 | — | 동아리담임 › 동아리활동관리 › … |
| `career` | 진로활동 | 1500 | 약 750자 | **O** | 학급담임 › 창의적체험활동 › 진로활동관리 › … |
| `auto` | 자율활동 | 1500 | 약 750자 | — | 학급담임 › 창의적체험활동 › 자율활동관리 › … |
| `behavior` | 행동특성및종합의견 | 1500 | **300자 권고** | — | 학급담임 › 행동특성및종합의견 › … |

각 프로파일이 UI 라벨, NEIS 안내 경로, 파일명, 설명 문구, `processWords`(과정 어휘 목록)를 함께 들고 있습니다. **탭을 하나 추가하려면 여기에 항목 하나만 더 넣으면 됩니다** — [§8.6](#86-창체-활동유형-추가하기).

### 6.2 규칙 목록

| 코드 | 태그 | 등급 | 색 | 무엇을 잡나 | 상수 |
|---|---|---|---|---|---|
| **PROHIBITED** | 기재불가 | **violation** | `m-red` | 교육부 기재불가 **10범주** (아래) | `:101` |
| **ORG** | 기관·사교육 | check | `m-brown` | 대학명 34개 + 교외기관·인증시험 | `:88` `:93` |
| **CAUTION** | 기재유의어 | check | `m-brown` | 상표·서비스명 → 대체 표현 | `:114` |
| **QUOTE** | 따옴표 | check | `m-brown` | 굽은 따옴표 `‘’“”` | `:499` |
| **MIDDOT** | 가운뎃점 | check | `m-brown` | `· ‧ ㆍ` | `:502` |
| **PARENROMAN** | 괄호영문 | check | `m-brown` | `한글(English)` | `:227` |
| **PLACEHOLDER** | 형식표현 | check | `m-amber` | `향후 ~적극 참여할 것으로 기대` 류 5개 | `:114` |
| **CAREER_LACK** | 진로연계부족 | check | `m-rose` | 진로 어휘가 하나도 없음 — **`career` 전용** | `:122` |
| **SPECULATIVE** | 추측표현 | check | `m-rose` | `~것 같음`, 추정·짐작 | `:206` |
| **PROCESS_LACK** | 과정부족 | check | `m-rose` | 60자 이상인데 프로파일별 과정 어휘 없음 | 프로파일 `processWords` |
| **FLOWERY** | 미사여구 | check | `m-amber` | 최상급 / 반복 | `:190` `:193` |
| **PATTERN** | 패턴반복 | check | `m-violet` | 끝 8자 동일 문장 2개 이상 | `:370` |
| **TEMPLATE** | 템플릿 | check | `m-violet` | `~을 통해 ~함양` | `:198` |
| **ENDING** | 종결혼용 | check | `m-slate` | 종결 형태 섞임 | `:414` |
| **SPACING** | 띄어쓰기 | check | `m-slate` | 구두점 12종 | `:243` |
| **DUP** | 문장중복 | check | `m-teal` | 다른 학생과 문장 중복 (`career-app.js:552`) | `:450` |
| **BYTE** | 바이트초과 | — | `m-red` | neis2 기준 초과 (`career-app.js:565`) | — |
| **CHAR** | 글자수초과 | — | `m-red` | `charLimit` 초과 — 행특 전용 | — |

`BYTE`·`CHAR`는 규칙 스캔이 아니라 `career-app.js`가 직접 만드는 항목이라 `grade`가 없습니다. "확정 위반만 보기" 필터는 **grade가 없는 항목을 통과시킵니다** (`career-app.js:86`) — 명백한 초과라 숨길 이유가 없다는 판단입니다.

### 6.3 기재불가 10범주 (`:101` `GLOBAL_PROHIBITED`)

생기부 어디에도 쓸 수 없는 항목입니다. 이것만 `violation`입니다.

1. 어학·자격시험 성적 — TOEIC, TOEFL, JLPT, 한능검, 컴활 …
2. 모의고사·학력평가 성적·석차 — 수능, 백분위, 표준점수, 등급 …
3. 논문·소논문 작성·게재 — 학술지, 학회 발표 …
4. 지식재산권 출원·등록 — 특허, 실용신안, 상표 …
5. 도서 출판 — 출판하였, 간행물 …
6. 해외 연수·활동 — 어학연수, 해외 봉사, 유학 …
7. 장학금 수혜 — 장학생, 장학재단 …
8. 부모·친인척 신분·직업 — `아버지는`, `부모님 직업` …
9. 대회·행사 수상 — 우수상, 금상, 표창 … (수상경력란 제외)
10. 교내외 대회 참가 — 경시대회, 올림피아드, 콘테스트 …

> **주의 (범주 2):** `등급`이라는 단어 하나로 매칭합니다. "3등급을 받음"뿐 아니라 **"난이도 등급", "등급을 나누는 활동"** 같은 무해한 문장도 걸립니다. 오탐이 잦으면 `:103`에서 `'등급'`을 빼고 `'등급을 받'`처럼 좁히세요.

### 6.4 원본이 포팅하지 않은 죽은 코드

`rules-career.js:8~14` 주석에 기록돼 있습니다. 원본 창체 점검기 HTML에 있었지만 **실제로 호출되지 않던** 코드라 옮기지 않았습니다: `CAREER_KEYWORDS`, `MAJOR_JOB_REGEX`, `PROCESS_INDICATORS`, `ACHIEVEMENT_CODE_REGEX`(교과용). `PROFILES.allowCareer` 필드는 구조 보존을 위해 데이터로만 남아 있고 **어떤 규칙도 참조하지 않습니다**.

---

## 7. 렌더링 · 색 체계

### 7.1 하이라이트 조립 (`checker-core.js:44` `buildAnnotatedHtml`)

1. `findings`를 `span[0]` 기준 오름차순 정렬
2. **겹치는 span은 앞선 것만 채택**하고 뒤엣것은 버림 (`:51`) — `<mark>` 중첩을 피하기 위함
3. 텍스트를 조각내며 이스케이프 → `<mark class="{color}" title="{note}">`

즉 한 글자에 규칙이 두 개 걸리면 **먼저 시작한 규칙 색만 보입니다.** 이슈 목록에는 둘 다 나옵니다.

XSS는 `escapeHtml`로 막습니다 (`:36`). 학생 이름·세특 본문 전부 이스케이프를 거칩니다.

### 7.2 형광펜 7색

색 값은 `assets/css/design-system.css`의 `--hl-*` 변수, 클래스 정의는 `assets/css/checker.css` 최상단에 있습니다.

| 클래스 | 의미 | 배경 | 글자 | DESIGN.md 유래 |
|---|---|---|---|---|
| `m-red` | 확정 위반 | `#ffe1e1` | `#a82a22` | Coral `#ff6363` |
| `m-brown` | 확인 필요 | `#f3ebe1` | `#7a5726` | 웜 뉴트럴 |
| `m-rose` | 내면·추측 | `#fbe3f8` | `#9c1a86` | Blush / Magenta |
| `m-amber` | 미사여구 | `#fdf1cf` | `#8a5a00` | **확장 토큰** ※ |
| `m-violet` | 패턴·템플릿 반복 | `#e1e0fc` | `#4a37c4` | Lavender / Iris |
| `m-teal` | 문장 중복 | `#cfeafa` | `#05628f` | Ice / Electric Blue |
| `m-slate` | 종결·띄어쓰기 | `#e6eaf0` | `#3f4b60` | Mist |

**※ `m-amber`만 DESIGN.md에 대응 토큰이 없습니다.** 나머지 6색은 전부 기존 토큰에서 파생시켰지만 앰버 계열은 팔레트에 없어 새로 만들었습니다. DESIGN.md를 엄격히 지키려면 이 색을 없애고 `S2미사여구`를 `m-rose`나 `m-slate`로 합치면 됩니다.

> **DESIGN.md와의 의도적 예외:** DESIGN.md는 "한 화면에 유채색 액센트 2개 초과 금지"를 규정하지만, 이 7색은 장식이 아니라 **규칙 종류를 나르는 데이터 인코딩**이라 예외로 뒀습니다. 대신 버튼·배경·링크 등 UI 크롬에는 액센트색을 일절 쓰지 않았습니다.

### 7.3 게이지 (`checker-core.js:73` `renderGauge`)

`width`가 아니라 `transform: scaleX()`로 채웁니다. 레이아웃 재계산 없이 합성만으로 처리돼 학생 수가 많아도 버벅이지 않습니다. 100%를 넘으면 잘리고, 초과 시 `.over` 클래스가 붙어 Coral로 바뀝니다.

### 7.4 이슈 목록 접기 (`checker-core.js:143` `groupBy`)

같은 태그가 여러 번 나오면 1행으로 접습니다 (`"'Google' 외 3건"`). 순서를 보존하는 그룹핑이라 첫 항목이 대표로 올라갑니다.

---

## 8. 자주 하는 수정 레시피

### 8.1 금지 키워드 추가하기

가장 흔한 작업입니다. **배열에 문자열만 넣으면 끝납니다.**

```js
// 교과 — rules-subject.js:271
var UNIVERSITY_KEYWORDS = [
  '서울대', '연세대', /* … */, '광운대',
  '한동대', '가천대'          // ← 추가
];

// 창체 — rules-career.js:88 에도 같은 배열이 따로 있다. 둘 다 고쳐야 한다.
```

**교과와 창체가 상수를 공유하지 않습니다.** `UNIVERSITY_KEYWORDS`, `ORG_KEYWORDS`, `CAUTION_TERMS`, `FLOWERY_*`는 두 파일에 **복제**돼 있습니다. 한쪽만 고치면 다른 페이지는 그대로입니다.

### 8.2 기재 유의어(대체 표현) 추가하기

```js
// rules-subject.js:284  /  rules-career.js:125
var CAUTION_TERMS = [
  { terms: ['Notion', '노션'], alt: '온라인 협업 도구' },   // ← 추가
  { terms: ['AI'], alt: '인공지능', boundary: true },       // 2글자 약어는 boundary 필수
];
```

`boundary: true`는 앞뒤가 한글/영숫자면 매칭하지 않게 합니다. **2글자 이하 약어에는 반드시 붙이세요.** 안 붙이면 `AI`가 `RAID` 안에서 잡힙니다.

### 8.3 판정 등급 바꾸기 (위반 ↔ 확인 필요)

`mk()` 호출의 2·3번째 인자가 등급과 색입니다.

```js
// rules-subject.js:625 — U2를 '위반'에서 '확인 필요'로 낮추기
findKeywordMatches(text, ORG_KEYWORDS).forEach(function (m) {
  out.push(mk('U2기관인증', 'check', 'm-brown', /* … */));
  //                        ^^^^^^^  ^^^^^^^^  violation/m-red 에서 변경
});
```

`grade`를 바꾸면 **"확정 위반만 보기" 필터 결과가 함께 바뀝니다.** 등급과 색은 같이 옮기는 게 자연스럽습니다.

### 8.4 화면에 나오는 규칙 이름 바꾸기

내부 코드(`f.rule`)는 그대로 두고 표시 이름만 바꿉니다.

```js
// subject-app.js:19
var RULE_LABELS = {
  R3과거시제: '과거형 표현',   // ← 이 문자열만 수정
};

// career-app.js:27 은 RULE_TAGS 라는 이름의 같은 역할 객체
```

내부 코드를 직접 바꾸면 판정 로직·테스트가 전부 깨집니다. **표시용 매핑만 건드리세요.**

### 8.5 새 규칙 추가하기 (교과)

```js
// 1) rules-subject.js 상단에 상수
var MY_WORDS = ['금지어1', '금지어2'];

// 2) scanExtras() 안(:612~)에 검출 로직 추가
findKeywordMatches(text, MY_WORDS).forEach(function (m) {
  out.push(mk('X1내규칙', 'check', 'm-brown', m.start, m.end, m.match, '우리 학교 내규 위반'));
});

// 3) subject-app.js:19 RULE_LABELS 에 표시 이름
X1내규칙: '교내 기준 위반',
```

`scanSSOT`이 아니라 **`scanExtras`에 넣으세요.** SSOT 블록은 외부 스크립트와 동기화 대상입니다. 코드 접두는 기존과 겹치지 않게(`X`, `Y` 등) 고르세요.

### 8.6 창체 활동유형 추가하기

`rules-career.js:26` `PROFILES`에 항목 하나를 넣고, `career.html`의 탭 버튼 하나를 추가하면 됩니다.

```js
volunteer: {
  key: 'volunteer',
  label: '봉사활동', byteLimit: 1500, charHint: '약 750자',
  placeholder: '봉사활동 특기사항을 붙여넣으세요.',
  exportName: '봉사활동_점검결과.xlsx',
  desc: '봉사 동기·역할·성찰 중심.',
  textPatterns: /특기.?사항|봉사.?활동|봉사/,
  textFallback: ['특기사항', '봉사활동', '내용'],
  processWords: ['봉사', '참여', '역할', '협력', '성찰', '실천'],
  neisPath: ['학급담임', '학생생활', '창의적체험활동', '봉사활동관리', '학생부 자료기록', '출력(XLS data)'],
  fileExample: '학급담임 → 봉사활동관리에서 출력한 XLS 파일',
  uploadNote: '',
  allowCareer: false, checkCareerLack: false
}
```

```html
<!-- career.html 의 #activityTabs 안 -->
<button type="button" class="toggle-btn" data-type="volunteer" role="tab" aria-selected="false">봉사활동</button>
```

자동 감지까지 되게 하려면 `career-app.js:317` `detectActivityTypeFromRows`에 패턴 한 줄을 더합니다.

### 8.7 규칙을 Node로 테스트하기

브라우저 없이 규칙을 돌려볼 수 있습니다. 키워드를 추가한 뒤 의도대로 잡히는지 확인할 때 유용합니다.

```js
// test.js — 프로젝트 루트에서 `node test.js`
const fs = require('fs'), vm = require('vm');
globalThis.XLSX = require('./assets/vendor/xlsx.full.min.js');
for (const f of ['checker-core.js', 'xlsx-parse.js', 'rules-subject.js', 'rules-career.js']) {
  vm.runInThisContext(fs.readFileSync('./assets/js/' + f, 'utf8'), { filename: f });
}
const { rulesSubject } = globalThis.SGB;

const findings = rulesSubject.scan('학생은 자료를 정리했고 발표함.', { id: 'general', byteLimit: 1500 });
findings.forEach(f => console.log(f.rule, '|', f.grade, '|', JSON.stringify(f.quote), '|', f.note));
```

### 8.8 바이트 제한 기본값 바꾸기

```js
rules-subject.js:249     var limit = byteLimit || 1500;   // 폴백값
rules-career.js:26~      PROFILES 각 항목의 byteLimit
subject.html / career.html  <input id="byteLimit" value="1500">   // 화면 기본값
```

세 군데를 맞춰야 합니다.

### 8.9 내보내기 컬럼 바꾸기

```js
// export.js:11
var DEFAULT_SUBJECT_COLUMNS = ['과목','번호','성명','글자수','바이트','제한','초과여부','이슈수','이슈상세'];
```

이 배열은 **컬럼 순서이자 데이터 키**입니다. 여기에 컬럼을 추가하면 `subject-app.js:706` `rowToExportRecord()`가 반환하는 객체에도 같은 이름의 키를 넣어야 값이 채워집니다 (없으면 빈 칸).

### 8.10 색 바꾸기

```css
/* assets/css/design-system.css — --hl-* 변수만 고치면 전 화면에 반영된다 */
--hl-red-bg: #ffe1e1;  --hl-red-ink: #a82a22;
```

`m-*` 클래스 정의(`checker.css` 최상단)는 이 변수를 참조만 하므로 건드릴 필요 없습니다. 범례 스와치도 같은 클래스를 쓰므로 자동으로 따라옵니다.

---

## 9. 알려진 이슈 · 원본 대비 변경점

### 9.1 알려진 이슈 (원본 동작 그대로 보존)

**원본 사이트와 판정 결과가 100% 같아야 하므로, 아래는 발견했지만 고치지 않았습니다.**
직접 고칠 수 있도록 원인·수정 코드·검증 결과를 함께 적어둡니다. 각 항목의 코드를
그대로 붙여 넣으면 적용되고, 그 순간부터 원본과 판정이 달라진다는 점만 기억하세요.

#### (1) 한글 유의어 + 조사 결합 시 미검출 ★ 영향 큼

`N1기재유의어`(교과) / `CAUTION`(창체)에서 3자 이하 한글 유의어 뒤에 조사가 붙으면 검출되지 않습니다.

| 문장 | 현재 |
|---|:---:|
| `유튜브 영상을 제작함` | 검출 O |
| `유튜브를 활용함` | **검출 X** |
| `네이버에서 검색함` | **검출 X** |
| `구글에서 검색함` | **검출 X** |
| `카톡으로 공유함` | **검출 X** |

**원인** — `hasWordBoundary()`가 매칭 뒤 글자가 한글이면 무조건 경계 실패로 처리합니다.
한국어는 조사가 명사에 붙으므로 사실상 "조사가 붙으면 못 잡는다"가 됩니다.

```js
// 현재 (rules-subject.js:351 · rules-career.js:525)
if (/[가-힣]/.test(before) || /[가-힣]/.test(after)) return false;   // ← 여기
```

**고치려면** — 뒤에 오는 것이 조사면 경계로 인정합니다. 두 파일 모두 같은 함수가 있으니 둘 다 바꾸세요.

```js
var JOSA_RE = /^(?:은|는|이|가|을|를|의|에|에서|에게|으로|로|와|과|랑|이랑|도|만|부터|까지|처럼|보다|마다|조차|밖에|라도|이라도|이나|나|든지|이든지)(?![가-힣])/;
function hasWordBoundary(text, start, end) {
  var before = start > 0 ? text[start - 1] : '';
  var after  = end < text.length ? text[end] : '';
  if (/[가-힣]/.test(before)) return false;
  if (/[가-힣]/.test(after) && !JOSA_RE.test(text.slice(end))) return false;
  if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) return false;
  return true;
}
```

**검증 완료** — 위 5개가 모두 검출되고, 합성어는 그대로 미검출을 유지합니다:
`유튜브방송반`, `네이버지도앱`, `구글링하며`, `메타인지`, `인공지능(AI)`, `유학생`.

#### (2) 창체 탭 전환 시 결과가 옛 프로파일로 남음

활동유형 탭을 바꾸면 범례·안내문·바이트 힌트는 즉시 갱신되는데 **결과는 재분석되지 않습니다.**
행동특성 결과를 띄운 채 동아리활동 탭으로 옮기면 범례는 동아리인데 결과 제목은
"행동특성및종합의견"이고, 동아리에는 없는 `글자수초과` 태그가 그대로 남습니다.

교과 페이지의 프로파일 드롭다운은 즉시 재분석합니다 (`subject-app.js:820`). 같은 성격의
조작인데 두 페이지 동작이 다릅니다.

**고치려면** (`career-app.js:750`) — 마지막 `saveState();` 를 아래로 바꿉니다.

```js
if (resultsData) analyzeAll(); else saveState();
```

#### (3) 창체 기재불가 동음이의어 오탐

기재불가는 가장 강한 `violation` 등급인데, 일반명사·동음이의어와 겹쳐 무해한 문장이
확정 위반으로 표시됩니다.

```
이순신 장군 동상을 조사함        ← '동상' (조각상)
겨울철 동상 예방 캠페인          ← '동상' (凍傷)
난이도 등급을 나누어 출제함       ← '등급'
멸종위기종 등급을 조사함          ← '등급'
유학생 친구와 교류함             ← '유학'
학교 대회에서 진행을 맡음         ← '대회에서'
입상자 인터뷰 기사를 작성함       ← '입상'
해외 활동 사례를 조사하여 비교함   ← '해외 활동'
수능 특강 교재 구성을 분석함      ← '수능'
석차를 매기지 않는 평가 방식 토론  ← '석차'
표창장 제작 활동을 기획함         ← '표창'
지역 축제 콘테스트를 취재함       ← '콘테스트'
```

**고치려면** — 검출을 빼면 진짜 위반을 놓치므로, **빼지 말고 등급만 낮추는 쪽**을 권합니다.
`rules-career.js`에 상수 두 개를 추가하고 두 함수를 조금 고칩니다.

```js
// 1) 상수 추가 (GLOBAL_PROHIBITED 위)
var PROHIBITED_AMBIGUOUS = { '등급': 1, '동상': 1 };        // 필요하면 '입상','표창' 등 추가
var PROHIBITED_SUFFIX_EXCLUDE = { '유학': /^생/ };          // '유학생'은 별개 단어

// 2) findGlobalProhibitedMatches() 안의 push 를 교체
var exclude = PROHIBITED_SUFFIX_EXCLUDE[m.match];
if (exclude && exclude.test(text.slice(m.end))) return;
matches.push({ start: m.start, end: m.end, match: m.match, label: entry.label,
               ambiguous: !!PROHIBITED_AMBIGUOUS[m.match] });

// 3) scan() 안의 PROHIBITED 라인을 교체
findGlobalProhibitedMatches(s).forEach(function (m) {
  if (m.ambiguous) add('PROHIBITED', 'check', m, m.label + ' — 다른 뜻으로 쓰였는지 확인', 'm-brown');
  else             add('PROHIBITED', 'violation', m, m.label, 'm-red');
});
```

**검증 완료** — `동상`·`등급`은 `check`로 내려가고 `유학생`은 제외되며,
`금상 수상`·`어학연수`·`소논문 게재`·`경시대회 참가`·`토익`·`특허 출원`은 `violation`을 유지합니다.

#### (4) 바이트 계산 로직 이중화

`checker-core.js:18`과 `rules-subject.js:48`에 같은 계산이 따로 있습니다. R10 기준을 바꾸려면 둘 다 고쳐야 합니다. → [§3](#3-바이트-계산--교과와-창체가-다르다)

#### (5) 상수 복제

`UNIVERSITY_KEYWORDS`·`ORG_KEYWORDS`·`CAUTION_TERMS`·`FLOWERY_*`가 교과/창체 두 파일에 복제돼 있습니다. → [§8.1](#81-금지-키워드-추가하기)

#### (6) 겹치는 span은 하나만 하이라이트

한 글자에 규칙이 둘 걸리면 먼저 시작한 것만 색이 보입니다(이슈 목록에는 둘 다 나옴). → [§7.1](#71-하이라이트-조립-checker-corejs44-buildannotatedhtml)

### 9.2 원본 대비 의도적으로 바꾼 것

**원칙: 판정 로직은 원본 그대로 둡니다.** 변경은 CSS·HTML(프레젠테이션 계층)에서만 하고,
DESIGN.md 준수가 그 이유입니다.

```
$ diff 원본/assets/js/*.js  →  rules-subject.js 1곳만 차이, 나머지 6개 diff=0
```

#### ★ 판정에 영향을 주는 유일한 변경 — FOREIGN_SUBJECTS 확장

사용자 요청으로 적용한 **의도적 수정 1건**입니다. `rules-subject.js:93`.

원본은 `['일본어', '공통영어']` 뿐이라, 부분일치로 `공통영어1`은 걸려도
**`영어`·`실용영어`·`영어독해와작문`은 걸리지 않아** 영단어가 전부 R1(확정 위반)로 떴습니다.
교과 프로파일 드롭다운으로 우회할 수는 있으나 그 설정은 전 과목 일괄 적용이라
국어와 영어가 섞인 파일에서는 어느 쪽으로 두어도 한쪽이 틀렸습니다.

```js
// 변경 후
var FOREIGN_SUBJECTS = ['영어','일본어','중국어','독일어','프랑스어','스페인어','러시아어','아랍어','베트남어'];
```

판정 로직은 손대지 않았고 **목록만 넓혔습니다.** 이 과목들의 알파벳·가나가
R1(확정 위반) → F1(확인 필요)로 내려갑니다.

검증(34항목): 외국어 교과 14종 전부 F1, `국어`·`수학`·`통합사회`·`물리학` 등 15종은 R1 유지,
프로파일 드롭다운 경로·F2 파일형식·가나 처리 모두 회귀 없음.

**되돌리려면** — 배열을 `['일본어', '공통영어']`로 되돌립니다.

#### 프레젠테이션 계층 변경

| 항목 | 변경 | 이유 |
|---|---|---|
| **디자인 전체** | CSS 5개 파일 전면 재작성 | DESIGN.md 준수 |
| **폰트** | Pretendard → **Paperlogy** | DESIGN.md의 Open Runde는 한글 글리프가 없음. 같은 성격(기하학적 산세리프)의 한글 서체로 대체 |
| **일러스트** | 원본 PNG 5개를 쓰지 않고, `empty-state.png` 1개만 DESIGN.md 색으로 새로 만듦 | 원본 PNG가 인디고(#4F46E5) 톤이라 팔레트와 충돌. DESIGN.md의 "일러스트 없음 · 실제 UI 아티팩트" 방침에 맞춤 |
| **토스트 `.show`** | CSS 규칙 **추가** | 원본 표시 결함 수정 — 아래 참조 |
| **섹션 간격** | 위아래 패딩 → 아래만 | 96+96=192px가 되어 DESIGN.md `--section-gap`(96px)의 두 배였음 |
| **`[hidden]` 방어** | 전역 1줄로 통합 | 원본은 `subject.css`에서 ID 선택자로 개별 처리 |

#### 이미지 자산을 어떻게 처리했나

`career-app.js:175` `emptyIllusHtml()`은 빈 상태 마크업을 런타임에 만들면서
`<img src="./assets/img/empty-state.png" onerror="...img-missing">`를 넣습니다.
**이 JS는 원본 그대로 두는 게 원칙**이라 경로를 바꿀 수 없었습니다.

그래서 그 경로에 **DESIGN.md 색(Electric Blue)으로 다시 그린 PNG를 넣었습니다**
(192×192, 2.5KB — 문서+체크 아이콘). 원본의 인디고 PNG를 그대로 쓰지 않으면서
JS도 건드리지 않고 404도 없앨 수 있는 유일한 방법이었습니다.

나머지 4개(`hero.png`·`tool-subject.png`·`tool-career.png`·`og.png`)는 **정적 HTML에서만
참조**하던 것이라 HTML을 고쳐 인라인 SVG/HTML 목업으로 대체했습니다.

원본 코드에는 이미지 실패 대비 폴백도 설계돼 있습니다 — 404가 나면 `onerror`가
`.img-missing`을 붙이고 `.illus-fallback` 안의 인라인 SVG가 대신 뜹니다. 그 폴백 SVG에도
인디고가 하드코딩돼 있어 CSS로 덮어뒀습니다. 프레젠테이션 속성(`fill=`/`stroke=`)은
CSS 선언보다 우선순위가 낮으므로 JS를 고치지 않고도 색을 바꿀 수 있습니다
(`design-system.css` §7).

```css
.illus-fallback svg [stroke] { stroke: var(--color-electric-blue); }
.illus-fallback svg [fill]:not([fill="none"]) { fill: var(--color-paper); }
```

즉 PNG를 지워도 인디고가 새어 나오지 않습니다.

#### 토스트 표시 결함

`checker-core.js:125` `toast()`는 `.toast`를 만들고 `.show`를 붙였다 2.4초 뒤 뗍니다.
그런데 **원본 CSS에는 `.show` 대응 규칙이 아예 없어** 토스트가 사라지지 않고 화면에 남습니다.

```
$ grep -n "show" 원본/assets/css/*.css   →  결과 없음
```

판정과 무관한 순수 표시 결함이고 CSS는 어차피 전면 재작성했으므로,
`design-system.css`에 opacity/visibility 전환을 추가해 고쳤습니다.
원본 동작(계속 남아 있음)으로 되돌리려면 `.toast.show` 블록을 지우면 됩니다.

### 9.3 디자인 토큰 매핑

원본의 시맨틱 변수명을 그대로 두고 값만 DESIGN.md 토큰으로 갈아끼웠습니다. 덕분에 JS와 클래스 계약을 건드리지 않고 디자인만 교체됐습니다.

| 원본 | → DESIGN.md |
|---|---|
| `--bg` `#F7F8FB` | Paper `#ffffff` (캔버스는 순백) |
| `--surface` | Paper `#ffffff` |
| `--ink` `#1B1F2E` | Ink `#1e1e1e` |
| `--ink-soft` `#5A6072` | Smoke `#666666` |
| `--line` `#E4E7EF` | Mist `#ccd1da` |
| `--brand` `#4F46E5` | **분리** — 버튼은 Midnight `#0d111b`, 액센트는 Electric Blue `#0098f2` |
| `--radius` `14px` | cards `16px` / largeCards `32px` |
| `--radius-sm` `10px` | 버튼·칩은 pill `100px`, 입력은 `10px` |

가장 중요한 변경은 **`--brand` 하나가 둘로 갈라진 것**입니다. DESIGN.md가 "액센트 컬러를 버튼 배경으로 쓰지 말 것"을 명시하므로, 채움 버튼은 Midnight를 쓰고 Electric Blue는 아이콘·게이지·아이브로우 라벨에만 씁니다.

### 9.4 검증 현황

작성 시점 기준으로 확인한 항목입니다.

- **원본 일치** — 벤더 2개 + JS 6개는 `diff=0`(바이트 동일). `rules-subject.js`만 FOREIGN_SUBJECTS 1곳 의도적 수정
- **로직 45개 항목** — Node에서 파싱·바이트·규칙·하이라이트 전수 확인 (표준/인쇄덤프/창체 3종 픽스처)
- **외국어 과목 34개 항목** — FOREIGN_SUBJECTS 확장 전용 검증(교과 29종 + 회귀 5종)
- **E2E** — 실제 브라우저에서 3페이지 콘솔 오류 0 · 네트워크 404 0
  - 업로드 → 판정 → 하이라이트 → 내보내기 3종(xlsx·zip·클립보드)
  - 다중 시트 선택, 다중 파일 병합, localStorage 복원, 구버전 캐시 호환
  - 학생 직접 추가·편집, 실시간 게이지, 전체 지우기, 빈 상태
  - 과목별/학생별 보기 전환, 과목 필터, 확정 위반만 보기, 이슈 그룹 접기
  - 창체 4개 활동유형 탭, 활동유형 자동 감지, 행특 300자 권고
  - XSS 이스케이프(`<script>` 주입 무력화 확인)
- **반응형** — 390px에서 3페이지 모두 가로 스크롤 없음
- **DESIGN.md 준수** — 그라디언트 0, 10px 미만 반경 0, 순수 검정 0, 액센트색 버튼 배경 0
- **문서 정합성** — 이 문서의 `파일:줄` 참조 전수 대조

미검증: NEIS 실제 출력 파일(합성 픽스처로만 테스트), Safari·Firefox.

> **캐시 주의** — JS를 고친 뒤 화면이 그대로면 브라우저 캐시입니다. 강력 새로고침(⌘⇧R)하거나
> `<script src="...js?v=2">`처럼 쿼리를 붙이세요. 실제로 이 프로젝트 테스트 중에 겪은 함정입니다.
