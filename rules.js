// 졸업 기준 데이터. 모든 값은 sources의 문서에 근거한다. 학사 기준은 해당 학년도 학사종합안내가 우선한다.
// verified: false 인 항목은 화면에 「확인 필요」로 표시된다. 근거를 확보하면 true로 바꾼다.
// 매년 새 학사종합안내가 나오면 handbook.year와 checks, 바뀐 기준값을 함께 갱신한다 (README 「매년 갱신」).
(function (root) {
  const RULES = {
    version: '2026학년도 학사종합안내',
    department: '단국대 천안 환경자원경제학과 (24학번부터 식품자원경제학과)',
    departmentShort: '식품자원경제학과',
    sampleData: false,

    // 사용자가 첨부한 학사종합안내 PDF를 이 기준과 대조한다 (Engine.checkHandbook).
    // all: 공백을 지운 문서 본문에 모두 들어 있어야 하는 문구. 없으면 그 기준이 바뀌었을 수 있다는 뜻.
    handbook: {
      year: 2026,
      title: '2026학년도 학사종합안내',
      file: 'docs/sources/2026-학사종합안내.pdf',
      checks: [
        { id: 'maxcr', label: '학기당 최대 19학점, 최저 12학점(최종학기 6)', sourceId: 'S-MAXCR', all: ['19학점이내', '최저수강신청학점은12학점(최종학기6학점)'] },
        { id: 'gpa', label: '직전 학기 4.0 이상 3학점 초과신청', sourceId: 'S-BONUSCR', all: ['4.0이상인학생은3학점초과신청가능'] },
        { id: 'innov', label: '혁신추가학점 (성적초과학점과 중복 불가)', sourceId: 'S-BONUSCR', all: ['혁신추가학점', '혁신융합대학교과목신청자'] },
        { id: 'carry', label: '수강신청 학점이월 3학점 이내', sourceId: 'S-BONUSCR', all: ['이월가능학점:3학점이내', '자동소멸'] },
        { id: 'fieldcr', label: '산업체현장실습 학점은 다음 학기 최대학점에서 제외', sourceId: 'S-INTERN', all: ['차기학기에이수학점만큼최대수강학점에서제외'] },
        { id: 'intern', label: '현장실습·인턴십은 전공선택, P/F', sourceId: 'S-INTERN', all: ['전공선택으로인정되며성적은P(이수),F(미이수)'] },
        { id: 'service', label: '사회봉사 32시간, 온라인특강 강좌당 2시간', sourceId: 'S-SERVICE', all: ['32시간(현장봉사+온라인특강)', '강좌당봉사시간2시간'] },
        { id: 'service-campus', label: '교내 봉사 최대 10시간, 헌혈 1회 4시간', sourceId: 'S-SERVICE', all: ['교내봉사시간이최대10시간', '헌혈은1회당4시간'] },
        { id: 'major63', label: '심화전공 63학점, 졸업 130학점', sourceId: 'S-HB-CUR', all: ['심화전공과정63이상', '130학점이상'] },
        { id: 'base12', label: '학부(과)기초 18 → 12학점 하향 (2024학년도 입학생까지)', sourceId: 'S-BASE', all: ['식품자원경제학과', '학부(과)기초이수기준은18학점에서12학점으로하향조정'] },
        { id: 'module', label: '식품자원경제학과 모듈형 트랙제 (G-2 사회적경제론)', sourceId: 'S-MODULE', all: ['식품자원경제학과(개설년도:2024학년도)', 'G-2.사회적경제론'] },
      ],
    },

    // 트랙을 이수하는 학생이 첨부하는 학과 트랙 교육과정 문서 (붙임2 최신판). Engine.checkTrackDoc
    trackDoc: {
      title: '(붙임2) 모듈형 교육과정_식품자원경제학과',
      file: 'docs/sources/붙임2-모듈형교육과정-식품자원경제학과.pdf',
      checks: [
        { id: 'modules', label: '모듈 구성 (G-2 사회적경제론)', sourceId: 'S-MODULE', all: ['학과교과목모듈화', 'G-2.사회적경제론(3)'] },
        { id: 'req6', label: '모듈 내 필수 6과목 (통계학기초·미시·소비자·거시·식품유통·마케팅조사분석)', sourceId: 'S-REQ24', all: ['통계학기초*', '소비자경제학*', '식품유통경제학*', '마케팅조사분석*', '미시경제학*', '거시경제학*'] },
        { id: 'dept', label: '학과전공트랙: 모듈 5개 × 6학점 = 30학점', sourceId: 'S-TRACKRULE', all: ['모듈D~L중해당모듈5개에서각모듈당최소6학점(총30학점)'] },
        { id: 'bio', label: '융합트랙: 모듈 3개 × 3학점 + 모듈 내 6 + M 8 + N·O 7', sourceId: 'S-TRACKRULE', all: ['해당모듈3개에서각모듈당최소3학점', '(모듈M최소8학점)+(모듈N+O최소7학점)'] },
        { id: 'common', label: '트랙 공통: 모듈 B·C·F·H 모듈 내 필수 이수', sourceId: 'S-TRACKRULE', all: ['모듈B,C,F,H의모듈내필수과목은반드시이수'] },
        { id: 'total', label: '트랙형 30 + 자유전공선택 33 = 최소 63학점', sourceId: 'S-TRACKRULE', all: ['트랙형30학점+자유전공선택33학점=최소63학점'] },
      ],
    },

    sources: {
      'S-MODULE': { title: '(붙임2) 모듈형 교육과정_식품자원경제학과 — 모듈 구성·과목', ref: 'p.1–2 / 2026 학사종합안내 [2.교육과정] p.60 「모듈형 트랙제 교육과정」 (G-2 사회적경제론)', verified: true },
      'S-REQ19': { title: '학과 공지 「전공 이수구분 및 동일교과목 안내」 — ~19학번 전공필수 18학점', ref: '미시경제학, 거시경제학, 계량경제학, 유통경제학(식품유통경제학), 환경경제학, 지역발전론. 마케팅조사분석은 원칙적으로 불인정 — 2020~2023학년도에 이수한 경우에만 계량경제학 대신 전공필수 인정(2024학년도 이후 이수분은 불인정). 학점: 2026 학사종합안내 [2.교육과정] p.26–31 이수기준표(2019~2014 환경자원경제학과: 전공필수 18, 전공선택 심화 45+, 학과기초 12, 대학기초교양 6은 2020학년도부터 면제)', verified: true },
      'S-REQ23': { title: '학과 공지 「전공 이수구분 및 동일교과목 안내」 — 20~23학번 전공필수 15학점', ref: '미시경제학, 거시경제학, 마케팅조사분석, 식품유통경제학(유통경제학), 환경경제학. 포털에 전공선택으로 되어 있어도 추후 「이수영역변경」으로 전공필수 전환 예정 → 이수구분과 관계없이 본인 입학기준 과목을 이수. 학점: 2026 학사종합안내 [2.교육과정] p.22–25 이수기준표(2020~2023 환경자원경제학과: 전공필수 15, 전공선택 심화 48+)', verified: true },
      'S-REQ24': { title: '(붙임2) 모듈 내 필수 6과목 (24학번 이상 적용) — 전공필수 없음, 모듈필수는 반드시 이수 (학과 공지)', ref: 'p.6(*) — 통계학기초, 미시, 소비자, 거시, 식품유통경제학, 마케팅조사분석 / 학사종합안내 [2.교육과정] p.60 밑줄 / p.20 이수기준표 전공필수 「–」', verified: true },
      'S-EQUIV': { title: '학과 공지 「전공 이수구분 및 동일교과목 안내」 — 2024학년도 개편 동일교과목', ref: '환경과경제=환경자원과경제, 식품과경제=식품자원과경제, 경제학원론1=경제원론, 경제학원론2=경제학이야기, 통계학이해=통계학기초, 경제사=한국경제사, 식품가격위험분석=식품가격분석, 유통경제학=식품유통경제학, 환경과국제무역=환경식품과무역, 환경정책=농식품정책론, 환경경영론=애그리비즈니스(폐지 과목, 붙임2 구판 G-2). 사회적경제론은 2026 신설 과목으로 애그리비즈니스와 동일교과목 아님(2026-11-07 학과 확인). 이미 이수한 과목의 동일교과목을 다시 신청하면 재수강 처리. 2024 이전 개편분은 학과사무실 문의', verified: true },
      'S-TRACK': { title: '(붙임2) 트랙 교육과정 구성 — 트랙별 모듈', ref: 'p.3', verified: true },
      'S-TRACKRULE': { title: '(붙임2) 트랙 운영 예시 — 트랙 이수 기준', ref: 'p.4–5: 심화전공 모듈 내 필수 18 + 나머지 45 = 63 (최신판 괄호 안 「자유전공선택 39」는 합계가 맞지 않아 45로 봄), 트랙형 30 + 자유전공선택 33 = 63', verified: true },
      'S-CURTABLE': { title: '(붙임2) 교육과정(트랙형) — 표준 이수 학기', ref: 'p.6. 실제 개설 과목은 매 학기 수강신청 기간에 확정되므로 계획은 추정. 기타: 취창업전공세미나1·2(2학점, 3·4학년), 캡스톤디자인1·2(3학년), 국내외인턴십1(18)·2(12), 산업체현장실습1(2)·2(4)', verified: true },
      'S-SIM': { title: '학점이수 자가진단 시뮬레이션 (교무처 학사팀)', ref: '편입생(2025, 23학번 교육과정): 전공 최저 63, 졸업 최저 130, 교양 최저 28, 학과(부)기초 12', verified: true },
      'S-HB-CUR': { title: '2026 학사종합안내 [2.교육과정] 입학년도 및 학과별 교육과정 이수기준표', ref: 'p.18–19(2026·2025), p.20(2024 식품자원경제학과), p.22(2023 환경자원경제학과): 심화전공 63 이상, 졸업 130', verified: true },
      'S-GEN19': { title: '2026 학사종합안내 [2.교육과정] p.26–27 — 2019·2018학년도 환경자원경제학과', ref: '공통교양 18 + 영역별교양 12 = 교양 30학점 (대학기초교양 6은 2020학년도부터 면제, 이수분은 학과기초로 통합)', verified: true },
      'S-GEN17': { title: '2026 학사종합안내 [2.교육과정] p.28–31 — 2017~2014학년도 환경자원경제학과', ref: '2017·2016: 공통 14 + 영역별 12 + 일반 2 = 28 / 2015·2014: 핵심 12 + 영역별 16 = 28 (대학기초교양 6은 2020학년도부터 면제)', verified: true },
      'S-GEN23': { title: '2026 학사종합안내 [2.교육과정] p.22 — 2023학년도 환경자원경제학과', ref: '공통교양 22 + 영역별교양 12 = 교양 34학점 (일반 재학생)', verified: true },
      'S-GEN24': { title: '2026 학사종합안내 [2.교육과정] p.20 — 2024학년도 식품자원경제학과', ref: '필수교양 18 + 영역별교양 12 = 교양 30학점 (일반 재학생)', verified: true },
      'S-GEN25': { title: '2026 학사종합안내 [2.교육과정] p.18–19 — 2025·2026학년도 식품자원경제학과', ref: '공통교양 16 + 영역교양 12 = 교양 28학점', verified: true },
      'S-BASE': { title: '2026 학사종합안내 [2.교육과정] p.15 「교육과정 개편에 따른 학과별 경과조치」', ref: '식품자원경제학과: 학부(과)기초 18학점 → 2024학년도 입학생까지 12학점으로 하향. 2025학년도부터 학문기초 12', verified: true },
      'S-INTERN': { title: '2026 학사종합안내 [4.현장실습] p.1 「산업체현장실습 및 인턴십」', ref: '산업체현장실습1(1개월·2학점)·2(2개월·4학점, 계절학기, 3학년부터), 국내·외인턴십1(6개월·18학점)·2(4개월·12학점, 정규학기). 전공선택으로 인정, P/F, 평점 미반영. 편입생은 2개 학기 이상 이수 후 신청. 산업체현장실습 학점은 차기 학기 최대수강학점에서 제외', verified: true },
      'S-OFFICE': { title: '학과 규정 (학과 사무실 확인)', ref: '트랙은 선택·최대 3개(2026-10-31 갱신), 한 과목 두 트랙 동시 인정(3개일 때 세 트랙 모두 인정되는지 미확인), 푸드바이오경제 트랙 이수 시 타과(M·N·O) 과목 전부 전공 인정', verified: true },
      'S-TRACKAPPLY': { title: '트랙 이수 신청 (학과 공지)', ref: '학기마다 한 번 신청기간 — 학과 홈페이지·과톡방 공지 확인', verified: true },
      'S-EXAM': { title: '졸업시험 면제 기준 (학과 안내) · 졸업논문(시험) 합격 필수 (2026 학사종합안내 [3.주요학사제도] p.1)', ref: 'TOEIC 800 이상(유효기간 내) / 학과 인정 외부 경연대회 입상(교수 승인, 입학 이후) / 국내외 전문학술지 게재 / 비교과 포인트 100점 이상', verified: true },
      'S-LANG': { title: '졸업인증제 공인외국어 (2026 학사종합안내 [3.주요학사제도] p.50–51)', ref: '라. 세부 인정기준(공인영어·해외연수·해외인턴십·영어원어강의·공인중국어·공인일본어·국제계절학기) + 마. 입학년도별 공인영어 기준표(공공인재대학 2024~·보건복지대학 2020~·생명자원과학대학 2013~: TOEIC 600 / TOEIC Speaking 120(IM2) / TEPS 480 / New TEPS 227 / TOEFL iBT 60 / OPIc IM1 / G-TELP Lv.2 50). 입학 후 취득한 유효기간(2년) 내 성적만 인정, 편입생은 직전 전적대학에서 인정받은 점수가 기준 이상이면 인정', verified: true },
      'S-SERVICE': { title: '2026 학사종합안내 [3.주요학사제도] p.49 「지역사회와함께하는서비스러닝(사회봉사)」, [2.교육과정] p.16', ref: '32시간(현장봉사 + 온라인특강) 이상. 2012~2024 입학자: 사회봉사온라인특강1·2·3 중 1강좌 이상 필수, 3회까지 인정(강좌당 2시간). 2025 입학자부터: 사회봉사온라인특강(563540) 1강좌 필수(2시간). 교내 봉사 최대 10시간, 헌혈 1회 4시간, VMS·1365 인증 봉사만 인정. 편입생은 전적대 성적표에 이수 기재 시 인정', verified: true },
      'S-MAXCR': { title: '2026 학사종합안내 [1.수강신청] p.2 「수강신청학점 범위」', ref: '일반학과 2013학년도 입학자부터 19학점 이내. 매 학기 최저 12학점(최종학기 6학점)', verified: true },
      'S-BONUSCR': { title: '2026 학사종합안내 [1.수강신청] p.2–3, [3.주요학사제도] p.2 「수강신청학점이월」', ref: '직전 학기 성적 4.0 이상 3학점 초과신청 / 혁신융합대학(바이오헬스 등) 교과목 신청 시 최대 3학점 추가 — 성적초과학점 대상자는 혁신추가학점 없음 / 직전 학기 최대수강신청 학점 중 신청하지 않은 학점 3학점 이내 이월, 다음 학기에 쓰지 않으면 소멸. 이월 제외: 학사경고자, 최저수강신청학점 미만자, 9학기 등록자 등. 예시 19 → 19~22 또는 22~25', verified: true },
      'S-OVER': { title: '2026 학사종합안내 [3.주요학사제도] p.1 「9학기 등록」, p.2 「수강신청 학점이월」', ref: '8개 학기 이상 등록하고 졸업요건을 충족하지 못한 자는 수강신청 후 등록을 하여야 하며, 미등록 시 제적처리 / 학점이월 제외자(직전 학기): 학사경고자, 최저수강신청학점 미만자, 9학기 등록자 및 학사학위취득 유예자 등', verified: true },
      'S-INNOV': { title: '2026 학사종합안내 [3.주요학사제도] p.11 — 바이오헬스 혁신융합대학 개설 교과목', ref: '바이오헬스인체의신비, 바이오헬스인간과질병, 바이오헬스기초의학, 바이오헬스약과건강, 미래식품과다이어트 등 (학과 M 모듈)', verified: true },
    },

    // 편입생 전적대 인정 학점 입력 항목 (포털 「영역별 이수 교과목 현황」의 전적대학인정학점 줄)
    transferAreas: [
      { key: 'gen', label: '공통교양', example: 28 },
      { key: 'base', label: '학과(부)기초 (계열교양)', example: 12 },
      { key: 'free', label: '자유선택', example: 25 },
      { key: 'major', label: '전공', example: 0 },
    ],

    maxCreditsPerSemester: { value: 19, sourceId: 'S-MAXCR', verified: true },

    minCreditsPerSemester: { value: 12, last: 6, sourceId: 'S-MAXCR' },

    // 학기당 추가 학점. gpa·carry는 직전 학기 결과로 정해진다.
    // innovation: 그 학기에 혁신융합대학 과목(modules)을 들으면 추가. 성적초과(gpa)를 받는 학기에는 없음.
    // carry: 직전 학기 최대학점 중 덜 신청한 학점(최대 max). 직전 학기가 최저학점 미만이면 이월 없음.
    creditBonus: {
      gpa: { minGpa: 4.0, credits: 3 },
      carry: { max: 3, noneFromSemester: 9 }, // 9학기 등록자는 다음 학기로 이월 없음 (S-OVER)
      innovation: { modules: ['M'], credits: 3, notWithGpa: true },
      sourceId: 'S-BONUSCR', verified: true,
    },

    // 사회봉사 시간 계산 (요건별 maxOnlineLectures는 curricula에서)
    service: { totalHours: 32, hoursPerOnlineLecture: 2, minOnlineLectures: 1, campusMaxHours: 10, bloodDonationHours: 4 },

    // 비교과 포인트 — 학과 유튜브 채널 영상 업로드 (교수 심사 통과 건)
    youtubePoints: [{ people: 1, points: 130 }, { people: 2, points: 100 }, { people: 3, points: 50 }, { people: 4, points: 35, orMore: true }],

    // 모듈. kind: major(학과 전공) / other(타과 융합 — 트랙 이수 시 전공 인정) / base(학과기초 교양)
    modules: {
      A: { name: '학문기초(교양)', kind: 'base' },
      B: { name: '경제학기초', kind: 'major' },
      C: { name: '경제학 전문지식(필수)', kind: 'major' },
      D: { name: '환경경영', kind: 'major' },
      E: { name: '지역개발', kind: 'major' },
      F: { name: '유통무역', kind: 'major' },
      G: { name: '농업경제', kind: 'major' },
      H: { name: '머천다이징', kind: 'major' },
      I: { name: '농식품정책', kind: 'major' },
      J: { name: '프라이싱', kind: 'major' },
      K: { name: '농식품산업및경영', kind: 'major' },
      L: { name: '경제성평가', kind: 'major' },
      M: { name: '바이오헬스혁신융합', kind: 'other' },
      N: { name: '식품영양', kind: 'other' },
      O: { name: '식품공학', kind: 'other' },
      P: { name: '현장중심교육·취창업진로', kind: 'major' }, // 학과 교육과정 「기타」 과목, 트랙 모듈 아님 (S-INTERN, S-CURTABLE)
    },

    // 트랙 공통: 모듈 B·C·F·H의 모듈 내 필수과목 (붙임2 p.4)
    trackCommonRequired: { courses: ['B-2', 'C-1', 'C-2', 'C-3', 'F-1', 'H-1'], sourceId: 'S-TRACKRULE' },
    maxTracks: 3, // 학과 안내 (2026-10-31 사용자 확인: 최대 3개)

    // 트랙 (붙임2 p.3–4). parts의 각 항목: modules에 속한 과목 학점 합이 min 이상
    tracks: {
      MKT: { name: '푸드마케팅', type: 'dept', parts: ['F', 'H', 'I', 'J', 'L'].map((m) => ({ modules: [m], min: 6 })) },
      REG: { name: '지역개발 및 컨설팅', short: '지역개발', type: 'dept', parts: ['D', 'E', 'H', 'I', 'K'].map((m) => ({ modules: [m], min: 6 })) },
      DIST: { name: '농식품유통', type: 'dept', parts: ['F', 'G', 'J', 'K', 'L'].map((m) => ({ modules: [m], min: 6 })) },
      ECON: { name: '경제학', type: 'dept', parts: ['D', 'E', 'G', 'J', 'L'].map((m) => ({ modules: [m], min: 6 })) },
      BIO: {
        name: '푸드바이오경제 (융합)', short: '푸드바이오', type: 'fusion',
        parts: [
          { modules: ['F'], min: 3 }, { modules: ['H'], min: 3 }, { modules: ['I'], min: 3 },
          { modules: ['F', 'H', 'I'], min: 15, label: 'F·H·I 합계 (모듈당 3 + 모듈 내 6)' },
          { modules: ['M'], min: 8 },
          { modules: ['N', 'O'], min: 7, label: 'N+O 식품영양·식품공학' },
        ],
        convertsToMajor: ['M', 'N', 'O'], // 트랙 이수 완료 시 이 모듈 과목 전부가 전공으로 인정 (S-OFFICE)
      },
    },

    // 교육과정. requirement kind:
    //   allOf(과목 전부) / majorElective(필수 외 전공) / majorTotal / total / area(교양·학과기초 영역 학점)
    //   toeic(점수 기준) / exam(졸업시험 또는 면제) / service(사회봉사 시간) / pf(직접 입력)
    // area의 minCreditsTransfer: 편입생은 전적대 일괄 인정 기준(시뮬레이션)을 쓴다.
    curricula: {
      // ~19학번 (2026 학사종합안내 p.26–31 — 2014~2019 이수기준표가 같고 교양만 다르다). 2013학번 이전은 지원하지 않는다.
      C17: {
        label: '14~17학번 (환경자원경제학과)', fromYear: 2014, toYear: 2017,
        requirements: [
          { id: 'REQ', name: '전공필수', kind: 'allOf', courses: ['C-1', 'C-3', 'L-3', 'F-1', 'D-1', 'E-1'], substitutes: [{ for: 'L-3', course: 'H-1', fromTerm: '2020-0', toTerm: '2023-3' }], sourceId: 'S-REQ19', verified: true },
          { id: 'ELEC', name: '전공선택', kind: 'majorElective', minCredits: 45, sourceId: 'S-REQ19', verified: true },
          { id: 'MAJOR', name: '전공 최저학점', kind: 'majorTotal', minCredits: 63, sourceId: 'S-REQ19', verified: true },
          { id: 'BASE', name: '학과(부)기초', kind: 'area', area: 'base', minCredits: 12, sourceId: 'S-REQ19', verified: true },
          { id: 'GEN', name: '교양 최저학점', kind: 'area', area: 'gen', minCredits: 28, sourceId: 'S-GEN17', parts: '공통교양 14 + 영역별교양 12 + 일반교양 2 (2016·2017) / 핵심교양 12 + 영역별교양 16 (2014·2015)', minCreditsTransfer: 28, transferSourceId: 'S-SIM', verified: true },
          { id: 'TOTAL', name: '졸업 최저학점', kind: 'total', minCredits: 130, sourceId: 'S-REQ19', verified: true },
          { id: 'EXAM', name: '졸업시험', kind: 'exam', sourceId: 'S-EXAM', verified: true },
          { id: 'LANG', name: '공인외국어', kind: 'lang', sourceId: 'S-LANG', verified: true },
          { id: 'SERVICE', name: '사회봉사', kind: 'service', maxOnlineLectures: 3, sourceId: 'S-SERVICE', verified: true },
        ],
      },
      C19: {
        label: '18~19학번 (환경자원경제학과)', fromYear: 2018, toYear: 2019,
        requirements: [
          { id: 'REQ', name: '전공필수', kind: 'allOf', courses: ['C-1', 'C-3', 'L-3', 'F-1', 'D-1', 'E-1'], substitutes: [{ for: 'L-3', course: 'H-1', fromTerm: '2020-0', toTerm: '2023-3' }], sourceId: 'S-REQ19', verified: true },
          { id: 'ELEC', name: '전공선택', kind: 'majorElective', minCredits: 45, sourceId: 'S-REQ19', verified: true },
          { id: 'MAJOR', name: '전공 최저학점', kind: 'majorTotal', minCredits: 63, sourceId: 'S-REQ19', verified: true },
          { id: 'BASE', name: '학과(부)기초', kind: 'area', area: 'base', minCredits: 12, sourceId: 'S-REQ19', verified: true },
          { id: 'GEN', name: '교양 최저학점', kind: 'area', area: 'gen', minCredits: 30, sourceId: 'S-GEN19', parts: '공통교양 18 + 영역별교양 12', minCreditsTransfer: 28, transferSourceId: 'S-SIM', verified: true },
          { id: 'TOTAL', name: '졸업 최저학점', kind: 'total', minCredits: 130, sourceId: 'S-REQ19', verified: true },
          { id: 'EXAM', name: '졸업시험', kind: 'exam', sourceId: 'S-EXAM', verified: true },
          { id: 'LANG', name: '공인외국어', kind: 'lang', sourceId: 'S-LANG', verified: true },
          { id: 'SERVICE', name: '사회봉사', kind: 'service', maxOnlineLectures: 3, sourceId: 'S-SERVICE', verified: true },
        ],
      },
      C23: {
        label: '20~23학번 (환경자원경제학과)', fromYear: 2020, toYear: 2023,
        requirements: [
          { id: 'REQ', name: '전공필수', kind: 'allOf', courses: ['C-1', 'C-3', 'H-1', 'F-1', 'D-1'], sourceId: 'S-REQ23', verified: true },
          { id: 'ELEC', name: '전공선택', kind: 'majorElective', minCredits: 48, sourceId: 'S-REQ23', verified: true },
          { id: 'MAJOR', name: '전공 최저학점', kind: 'majorTotal', minCredits: 63, sourceId: 'S-HB-CUR', verified: true },
          { id: 'BASE', name: '학과(부)기초', kind: 'area', area: 'base', minCredits: 12, sourceId: 'S-BASE', verified: true },
          { id: 'GEN', name: '교양 최저학점', kind: 'area', area: 'gen', minCredits: 34, sourceId: 'S-GEN23', parts: '공통교양 22 + 영역별교양 12', minCreditsTransfer: 28, transferSourceId: 'S-SIM', verified: true },
          { id: 'TOTAL', name: '졸업 최저학점', kind: 'total', minCredits: 130, sourceId: 'S-HB-CUR', verified: true },
          { id: 'EXAM', name: '졸업시험', kind: 'exam', sourceId: 'S-EXAM', verified: true },
          { id: 'LANG', name: '공인외국어', kind: 'lang', sourceId: 'S-LANG', verified: true },
          { id: 'SERVICE', name: '사회봉사', kind: 'service', maxOnlineLectures: 3, sourceId: 'S-SERVICE', verified: true },
        ],
      },
      C24: {
        label: '24학번 (식품자원경제학과)', fromYear: 2024, toYear: 2024,
        requirements: [
          { id: 'REQ', name: '모듈 내 필수', kind: 'allOf', courses: ['B-2', 'C-1', 'C-2', 'C-3', 'F-1', 'H-1'], sourceId: 'S-REQ24', verified: true }, // 전공필수 없음, 모듈필수는 반드시 이수
          { id: 'ELEC', name: '자유전공선택', kind: 'majorElective', minCredits: 45, sourceId: 'S-TRACKRULE', verified: true },
          { id: 'MAJOR', name: '전공 최저학점', kind: 'majorTotal', minCredits: 63, sourceId: 'S-HB-CUR', verified: true },
          { id: 'BASE', name: '학과(부)기초', kind: 'area', area: 'base', minCredits: 12, sourceId: 'S-BASE', verified: true },
          { id: 'GEN', name: '교양 최저학점', kind: 'area', area: 'gen', minCredits: 30, sourceId: 'S-GEN24', parts: '필수교양 18 + 영역별교양 12', minCreditsTransfer: 28, transferSourceId: 'S-SIM', verified: true },
          { id: 'TOTAL', name: '졸업 최저학점', kind: 'total', minCredits: 130, sourceId: 'S-HB-CUR', verified: true },
          { id: 'EXAM', name: '졸업시험', kind: 'exam', sourceId: 'S-EXAM', verified: true },
          { id: 'LANG', name: '공인외국어', kind: 'lang', sourceId: 'S-LANG', verified: true },
          { id: 'SERVICE', name: '사회봉사', kind: 'service', maxOnlineLectures: 3, sourceId: 'S-SERVICE', verified: true },
        ],
      },
      C25: {
        label: '25학번 이상 (식품자원경제학과)', fromYear: 2025,
        requirements: [
          { id: 'REQ', name: '모듈 내 필수', kind: 'allOf', courses: ['B-2', 'C-1', 'C-2', 'C-3', 'F-1', 'H-1'], sourceId: 'S-REQ24', verified: true }, // 전공필수 없음, 모듈필수는 반드시 이수
          { id: 'ELEC', name: '자유전공선택', kind: 'majorElective', minCredits: 45, sourceId: 'S-TRACKRULE', verified: true },
          { id: 'MAJOR', name: '전공 최저학점', kind: 'majorTotal', minCredits: 63, sourceId: 'S-HB-CUR', verified: true },
          { id: 'BASE', name: '학문기초', kind: 'area', area: 'base', minCredits: 12, sourceId: 'S-BASE', verified: true },
          { id: 'GEN', name: '교양 최저학점', kind: 'area', area: 'gen', minCredits: 28, sourceId: 'S-GEN25', parts: '공통교양 16 + 영역교양 12', minCreditsTransfer: 28, transferSourceId: 'S-SIM', verified: true },
          { id: 'TOTAL', name: '졸업 최저학점', kind: 'total', minCredits: 130, sourceId: 'S-HB-CUR', verified: true },
          { id: 'EXAM', name: '졸업시험', kind: 'exam', sourceId: 'S-EXAM', verified: true },
          { id: 'LANG', name: '공인외국어', kind: 'lang', sourceId: 'S-LANG', verified: true },
          { id: 'SERVICE', name: '사회봉사', kind: 'service', maxOnlineLectures: 1, sourceId: 'S-SERVICE', verified: true },
        ],
      },
    },

    // 졸업인증제 공인외국어 — 하나만 충족하면 된다 (2026 학사종합안내 p.50–51).
    // 학과가 속했던 대학(생명자원과학 2013~·보건복지 2020~·공공인재 2024~)의 공인영어 기준은 모두 같은 값이다.
    // G-TELP는 2007학년도 이후 입학자 전체 소급 적용(같은 쪽 ※).
    languageCert: {
      tests: [
        { id: 'toeic', label: 'TOEIC', min: 600 },
        { id: 'toeicSpeaking', label: 'TOEIC Speaking', min: 120, note: 'IM2' },
        { id: 'newTeps', label: 'New TEPS', min: 227 },
        { id: 'teps', label: 'TEPS (기존)', min: 480 },
        { id: 'toefl', label: 'TOEFL iBT', min: 60 },
        { id: 'opic', label: 'OPIc', levels: ['NL', 'NM', 'NH', 'IL', 'IM1', 'IM2', 'IM3', 'IH', 'AL'], min: 'IM1' },
        { id: 'gtelp', label: 'G-TELP Lv.2', min: 50 },
      ],
      // 시험 외 인정 방법. 영어원어강의·해외연수·국제계절학기는 포털에서 자동 처리, 나머지는 서류 제출
      routes: [
        { id: 'englishCourses', label: '영어원어강의 전공(전공필수·전공선택) 2강좌 이상 A학점 이상', note: '학과기초·전공세미나 제외, 자동 처리' },
        { id: 'abroad', label: '해외어학연수·국외대학 교류학생으로 학점 이수', note: '어학연수는 3학점 이상 인정된 경우, 자동 처리' },
        { id: 'intern', label: '해외인턴십 12학점 이상 인정', note: '졸업인증신청서·학점인정확인서·출입국사실증명서 제출' },
        { id: 'summer', label: '국제계절학기(GV·AP) 9학점 이상', note: '자동 처리' },
        { id: 'chinese', label: '공인중국어 HSK 3급 180점 이상', note: '2025학년도 입학자부터 HSK 4급 180점 이상' },
        { id: 'japanese', label: '공인일본어 JPT 550점 / JLPT N2 이상' },
      ],
    },

    examExemptToeic: 800,
    examExemptPoints: 100,

    // 교과목 (붙임2 p.2 모듈표 + p.6 표준 이수 학기). code: 학수번호(성적표에서 확인된 것만)
    // formerNames: 2024학년도 개편 전 동일교과목 이름 (S-EQUIV). 같은 과목으로 보며, 이미 들었으면 다시 들을 때 재수강 처리된다.
    // offered: 표준 개설 학기(1·2) — 추정값. 빈 배열 = 정보 없음
    courses: [
      { id: 'A-1', name: '식품자원과 경제', credits: 3, module: 'A', offered: [1], formerNames: ['식품과경제'] },
      { id: 'A-2', name: '환경자원과 경제', credits: 3, module: 'A', offered: [1], formerNames: ['환경과경제'] },
      { id: 'A-3', name: '지역과 경제', credits: 3, module: 'A', offered: [2] },
      { id: 'A-4', name: '경제학이야기', credits: 3, module: 'A', offered: [2], formerNames: ['경제학원론2'] },
      { id: 'B-1', name: '경제원론', credits: 3, module: 'B', offered: [1], formerNames: ['경제학원론1'] },
      { id: 'B-2', code: '446440', name: '통계학기초', credits: 3, module: 'B', offered: [2], formerNames: ['통계학이해'] },
      { id: 'C-1', code: '345790', name: '미시경제학', credits: 3, module: 'C', offered: [2] },
      { id: 'C-2', code: '553100', name: '소비자경제학', credits: 3, module: 'C', offered: [1] },
      { id: 'C-3', code: '303540', name: '거시경제학', credits: 3, module: 'C', offered: [1] },
      { id: 'D-1', code: '438630', name: '환경경제학', credits: 3, module: 'D', offered: [2] },
      { id: 'D-2', name: '환경영향 및 전과정평가', credits: 3, module: 'D', offered: [1], aliases: ['환경영향과 전과정평가'] },
      { id: 'D-3', code: '411210', name: '지속가능발전론', credits: 3, module: 'D', offered: [2] },
      { id: 'E-1', code: '479170', name: '지역발전론', credits: 3, module: 'E', offered: [1] },
      { id: 'E-2', name: '지역산업론', credits: 3, module: 'E', offered: [2] },
      { id: 'E-3', name: '커뮤니티발전론', credits: 3, module: 'E', offered: [1] },
      { id: 'E-4', code: '459750', name: '지역정책', credits: 3, module: 'E', offered: [2] },
      { id: 'F-1', code: '553110', name: '식품유통경제학', credits: 3, module: 'F', offered: [2], formerNames: ['유통경제학'] },
      { id: 'F-2', code: '446410', name: '유통관리론', credits: 3, module: 'F', offered: [1] },
      { id: 'F-3', name: '환경식품과 무역', credits: 3, module: 'F', offered: [2], formerNames: ['환경과국제무역'] },
      { id: 'G-1', name: '농업경제학', credits: 3, module: 'G', offered: [2] },
      { id: 'G-2', name: '사회적경제론', credits: 3, module: 'G', offered: [2] }, // 2026 신설 (학사종합안내 p.60). 애그리비즈니스와 동일교과목 아님 (2026-11-07 학과 확인)
      { id: 'G-3', name: '한국경제사', credits: 3, module: 'G', offered: [1], formerNames: ['경제사'] },
      // 폐지 과목: 붙임2 구판의 G-2. 사회적경제론 신설로 없어졌지만 이수한 학생은 G 모듈 학점으로 인정 (2026-11-07 학과 확인).
      // 들은 학생만 보이고 추천하지 않는다. 환경경영론과 동일교과목 (S-EQUIV)
      { id: 'G-4', name: '애그리비즈니스', credits: 3, module: 'G', offered: [], noAutoPlan: true, discontinued: true, formerNames: ['환경경영론'] },
      { id: 'H-1', code: '534890', name: '마케팅조사분석', credits: 3, module: 'H', offered: [2] },
      { id: 'H-2', name: '그린마케팅', credits: 3, module: 'H', offered: [1] },
      { id: 'H-3', code: '553780', name: '신제품개발프로세스', credits: 3, module: 'H', offered: [1] },
      { id: 'I-1', name: '농식품정책론', credits: 3, module: 'I', offered: [2], formerNames: ['환경정책'] },
      { id: 'I-2', code: '534900', name: '식품안전경제학', credits: 3, module: 'I', offered: [1] },
      { id: 'I-3', code: '553770', name: '식품위생법사례분석', credits: 3, module: 'I', offered: [1] },
      { id: 'J-1', name: '식품가격분석', credits: 3, module: 'J', offered: [2], formerNames: ['식품가격위험분석'] },
      { id: 'J-2', name: '상품선물 및 옵션', credits: 3, module: 'J', offered: [2] },
      { id: 'J-3', name: '온라인유통 및 물류', credits: 3, module: 'J', offered: [1] },
      { id: 'K-1', code: '436280', name: '협동조합론', credits: 3, module: 'K', offered: [1] },
      { id: 'K-2', code: '553740', name: '경영계획법', credits: 3, module: 'K', offered: [2] },
      { id: 'K-3', name: '농식품창업론', credits: 3, module: 'K', offered: [1] },
      { id: 'L-1', code: '553120', name: '경제가치분석', credits: 3, module: 'L', offered: [1] },
      { id: 'L-2', name: '푸드테크와 경제', credits: 3, module: 'L', offered: [2] },
      { id: 'L-3', name: '계량경제학', credits: 3, module: 'L', offered: [1] },
      // 융합 모듈 (타과 과목) — 표준 개설 학기 정보 없음
      { id: 'M-1', code: '541980', name: '인체의 신비', credits: 2, module: 'M', offered: [], aliases: ['바이오헬스인체의신비'] },
      { id: 'M-2', code: '548150', name: '인간과 질병', credits: 2, module: 'M', offered: [], aliases: ['바이오헬스인간과질병'] },
      { id: 'M-3', code: '548750', name: '미래식품과다이어트', credits: 2, module: 'M', offered: [] },
      { id: 'M-4', code: '541990', name: '기초의학', credits: 2, module: 'M', offered: [], aliases: ['바이오헬스기초의학'] },
      { id: 'M-5', name: '약과 건강', credits: 2, module: 'M', offered: [] },
      { id: 'N-1', name: '기능성식품학', credits: 2, module: 'N', offered: [] },
      { id: 'N-2', code: '378800', name: '영양학', credits: 3, module: 'N', offered: [] },
      { id: 'N-3', name: '식품학', credits: 3, module: 'N', offered: [] },
      { id: 'N-4', name: '급식경영학', credits: 3, module: 'N', offered: [] },
      { id: 'O-1', code: '369590', name: '식품저장학', credits: 2, module: 'O', offered: [] },
      { id: 'O-2', code: '312930', name: '관능검사', credits: 2, module: 'O', offered: [] },
      { id: 'O-3', name: '식품품질학', credits: 3, module: 'O', offered: [] },
      // 현장실습·인턴십 (S-INTERN) — 직접 신청하는 과정이라 추천안에는 넣지 않는다(noAutoPlan)
      { id: 'P-1', name: '산업체현장실습1', credits: 2, module: 'P', offered: [], noAutoPlan: true },
      { id: 'P-2', name: '산업체현장실습2', credits: 4, module: 'P', offered: [], noAutoPlan: true },
      { id: 'P-3', name: '국내·외인턴십1', credits: 18, module: 'P', offered: [], noAutoPlan: true, aliases: ['국내인턴십1', '국외인턴십1'] },
      { id: 'P-4', name: '국내·외인턴십2', credits: 12, module: 'P', offered: [], noAutoPlan: true, aliases: ['국내인턴십2', '국외인턴십2'] },
      // 붙임2 p.6 「기타」: 캡스톤디자인(3학년, 3학점), 취창업전공세미나(3·4학년, 2학점). 이수영역은 문서에 없어 전공으로 본다 — 성적표의 영역으로 확인 필요
      { id: 'P-5', name: '캡스톤디자인1', credits: 3, module: 'P', offered: [], noAutoPlan: true },
      { id: 'P-6', name: '캡스톤디자인2', credits: 3, module: 'P', offered: [], noAutoPlan: true },
      { id: 'P-7', name: '취창업진로세미나1', credits: 2, module: 'P', offered: [], noAutoPlan: true, aliases: ['취창업전공세미나1'] },
      { id: 'P-8', name: '취창업진로세미나2', credits: 2, module: 'P', offered: [], noAutoPlan: true, aliases: ['취창업전공세미나2'] },
    ],
  };


  // 학과 교육과정 표 (붙임2 p.6 「식품자원경제학과 교육과정(트랙형)」). 트랙을 이수하지 않는 학생은 이 표로 과목을 본다.
  // term: 표준 이수 학년-학기. * 필수과목 표시는 학번별 전공필수(curricula)로 따로 붙인다.
  RULES.curriculumTable = {
    sourceId: 'S-CURTABLE',
    groups: [
      { title: '교양 (학과기초)', rows: [
        { term: '1-1', courses: ['A-2', 'A-1'] },
        { term: '1-2', courses: ['A-4', 'A-3'] },
      ] },
      { title: '전공과목', rows: [
        { term: '1-1', courses: ['B-1'] },
        { term: '1-2', courses: ['B-2'] },
        { term: '2-1', courses: ['C-2', 'K-1', 'G-3', 'E-1', 'H-3'] },
        { term: '2-2', courses: ['F-1', 'H-1', 'C-1', 'E-2', 'J-1'] },
        { term: '3-1', courses: ['C-3', 'F-2', 'L-3', 'L-1', 'I-3', 'K-3'] },
        { term: '3-2', courses: ['D-1', 'F-3', 'D-3', 'L-2', 'K-2', 'J-2'] },
        { term: '4-1', courses: ['D-2', 'I-2', 'H-2', 'E-3', 'J-3'] },
        { term: '4-2', courses: ['G-1', 'I-1', 'E-4', 'G-2'] },
      ] },
      { title: '기타', fold: true, rows: [
        { term: '3·4', courses: ['P-7', 'P-8'] },
        { term: '3', courses: ['P-5', 'P-6'] },
        { term: '4-1·2', courses: ['P-3', 'P-4', 'P-1', 'P-2'] },
      ] },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RULES;
  else root.RULES = RULES;
})(this);
