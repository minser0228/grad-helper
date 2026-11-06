const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules.js');
const E = require('../engine.js');
// 본인 이수 내역·붙임2 본문은 개인·학과 자료라 저장소에 올리지 않는다(.gitignore). 없으면 그 테스트는 건너뛴다.
const fs = require('fs');
const path = require('path');
const SELF_PATH = path.join(__dirname, '..', 'cases', 'self-2023.json');
const self = fs.existsSync(SELF_PATH) ? require(SELF_PATH) : null;
const testSelf = self ? test : test.skip;
const TRACK_PATH = path.join(__dirname, 'fixtures', 'track-doc.txt');
const TRACK_TEXT = fs.existsSync(TRACK_PATH) ? fs.readFileSync(TRACK_PATH, 'utf8') : null;
const testTrack = TRACK_TEXT ? test : test.skip;

const regular = { studentType: 'regular', curriculum: 'C24', tracks: [], extra: {}, startTerm: '2027-1', remainingSemesters: 4, maxCredits: 19 };
const ids = (status, ...xs) => xs.map((id) => ({ id, status }));
const req = (ev, id) => ev.requirements.find((r) => r.id === id);

testSelf('현재(포털 시점) 판정: 전공·졸업 학점이 학사팀 시뮬레이션 취득 열과 같다', () => {
  const ev = E.evaluate(R, self.profile, self.taken, 'now');
  assert.deepStrictEqual(['MAJOR', 'TOTAL', 'BASE', 'GEN'].map((id) => req(ev, id).earned), [45, 119, 12, 28]);
  assert.deepStrictEqual(ev.converted, []);
});

testSelf('예측: 두 트랙 완료 → 타과 15학점 전공 인정, 학과 필수 6과목 충족, 졸업학점 여유 1', () => {
  const ev = E.evaluate(R, self.profile, self.taken, 'predict');
  assert.ok(ev.tracks.every((t) => t.satisfied));
  assert.strictEqual(ev.convertedCredits, 15);
  assert.strictEqual(req(ev, 'MAJOR').earned, 66);
  assert.ok(req(ev, 'REQ').satisfied);
  assert.strictEqual(req(ev, 'TOTAL').fragile.slack, 1);
});

test('학과 공지: ~19학번 6과목 18학점, 20~23학번 5과목 15학점, 24학번~ 전공필수 없음(모듈 내 필수)', () => {
  const reqOf = (k) => R.curricula[k].requirements.find((r) => r.kind === 'allOf');
  const names = (k) => reqOf(k).courses.map((id) => R.courses.find((c) => c.id === id).name).sort();
  assert.deepStrictEqual(names('C19'), ['거시경제학', '계량경제학', '미시경제학', '식품유통경제학', '지역발전론', '환경경제학'].sort());
  assert.deepStrictEqual(names('C17'), names('C19'));
  assert.deepStrictEqual(names('C23'), ['거시경제학', '마케팅조사분석', '미시경제학', '식품유통경제학', '환경경제학'].sort());
  assert.strictEqual(reqOf('C24').name, '모듈 내 필수');
  assert.ok(reqOf('C24').courses.includes('B-2'));
  // 학사종합안내 이수기준표: 전공필수 + 전공선택(심화) = 63
  for (const k of ['C17', 'C19', 'C23']) {
    const r = R.curricula[k].requirements;
    const cr = reqOf(k).courses.reduce((s, id) => s + R.courses.find((c) => c.id === id).credits, 0);
    assert.strictEqual(cr + r.find((x) => x.kind === 'majorElective').minCredits, 63, k);
  }
  assert.deepStrictEqual([2014, 2017, 2018, 2019, 2020, 2023, 2024, 2026, 2013].map((y) => E.curriculumForYear(R, y)), ['C17', 'C17', 'C19', 'C19', 'C23', 'C23', 'C24', 'C25', null]);
});

test('~19학번: 마케팅조사분석은 2020~2023학년도 이수분만 계량경제학 대신 전공필수 인정', () => {
  const base = ['C-1', 'C-3', 'F-1', 'D-1', 'E-1'].map((id) => ({ id, status: 'done', term: '2019-1' }));
  const p = { ...regular, curriculum: 'C19' };
  const r = (term) => req(E.evaluate(R, p, [...base, { id: 'H-1', status: 'done', term }], 'now'), 'REQ');
  assert.ok(r('2021-2').satisfied);
  assert.match(r('2021-2').note, /계량경제학 대신 인정/);
  assert.ok(!r('2024-1').satisfied);
  assert.deepStrictEqual(r('2024-1').missing, ['L-3']);
  assert.ok(!r(undefined).satisfied); // 수강 학기를 모르면 인정하지 않고 안내
  assert.match(r(undefined).note, /판단하지 못함/);
  // 인정된 마케팅조사분석은 전공선택에 중복 계산하지 않는다
  const ev = E.evaluate(R, p, [...base, { id: 'H-1', status: 'done', term: '2021-2' }], 'now');
  assert.strictEqual(req(ev, 'ELEC').earned, 0);
});

test('동일교과목: 2024 개편 전 과목명은 새 과목으로 읽는다 (재수강 대상)', () => {
  const pairs = { 환경과경제: 'A-2', 식품과경제: 'A-1', 경제학원론1: 'B-1', 경제학원론2: 'A-4', 통계학이해: 'B-2', 경제사: 'G-3', 식품가격위험분석: 'J-1', 유통경제학: 'F-1', 환경과국제무역: 'F-3', 환경정책: 'I-1', 환경경영론: 'G-4' };
  for (const [old, id] of Object.entries(pairs)) assert.strictEqual((E.findCourse(R, { name: old }) || {}).id, id, old);
  assert.strictEqual(E.findCourse(R, { name: '_유통경제학', code: '111111' }).id, 'F-1');
});

testSelf('푸드바이오 트랙이 미완료면: 예측은 이수를 가정해 전공 인정, 엄격 판정·현재는 전공 인정 안 함', () => {
  const taken = self.taken.filter((t) => t.id !== 'M-4');
  const strict = E.evaluate(R, self.profile, taken, 'predictStrict');
  assert.ok(!strict.tracks.find((t) => t.id === 'BIO').satisfied);
  assert.strictEqual(strict.convertedCredits, 0);
  assert.strictEqual(req(strict, 'MAJOR').earned, 51);
  const assumed = E.evaluate(R, self.profile, taken, 'predict');
  assert.deepStrictEqual(assumed.assumedTracks, ['BIO']);
  assert.strictEqual(req(assumed, 'MAJOR').earned, 64);
  assert.strictEqual(assumed.allSatisfied, false); // 트랙 미완료이므로 졸업 가능으로 보지 않음
  assert.strictEqual(E.evaluate(R, self.profile, taken, 'now').convertedCredits, 0);
});

test('한 과목은 여러 트랙에 동시에 인정되고, 트랙은 최대 3개', () => {
  const ev = E.evaluate(R, { ...regular, tracks: ['REG', 'BIO', 'MKT', 'DIST'] }, ids('done', 'H-1'), 'now');
  assert.strictEqual(ev.tracks.length, 3);
  assert.deepStrictEqual(ev.tracks.map((t) => t.id), ['REG', 'BIO', 'MKT']);
  for (const t of ev.tracks) assert.strictEqual(t.parts.find((p) => p.modules.join() === 'H').earned, 3);
});

test('일반 재학생은 전적대 인정 학점이 없고, 교양·학과기초를 직접 채워야 한다', () => {
  const ev = E.evaluate(R, { ...regular, transferCredits: { gen: 28 } }, [
    ...ids('done', 'A-1', 'A-2'),
    { custom: true, id: 'x1', name: '대학영어1', credits: 2, area: 'gen', status: 'done' },
  ], 'now');
  assert.strictEqual(req(ev, 'BASE').earned, 6);
  assert.strictEqual(req(ev, 'GEN').earned, 2);
  assert.strictEqual(req(ev, 'TOTAL').earned, 8);
});

test('졸업시험: 합격 또는 면제 요건(TOEIC 800, 경연대회, 학술지, 포인트 100) 중 하나', () => {
  const ex = (extra) => req(E.evaluate(R, { ...regular, extra }, [], 'now'), 'EXAM').satisfied;
  assert.strictEqual(ex({}), false);
  assert.strictEqual(ex({ toeic: 790 }), false);
  assert.strictEqual(ex({ toeic: 800 }), true);
  assert.strictEqual(ex({ contest: true }), true);
  assert.strictEqual(ex({ points: 100 }), true);
  assert.strictEqual(ex({ examPassed: true }), true);
});

test('공인외국어: TOEIC 600 이상', () => {
  const lang = (toeic) => req(E.evaluate(R, { ...regular, extra: { toeic } }, [], 'now'), 'LANG').satisfied;
  assert.strictEqual(lang(595), false);
  assert.strictEqual(lang(600), true);
});

test('공인외국어: 다른 공인영어 시험·시험 외 인정 방법·포털 이수 중 하나 (학사종합안내 p.50–51)', () => {
  const lang = (extra) => req(E.evaluate(R, { ...regular, extra }, [], 'now'), 'LANG').satisfied;
  assert.strictEqual(lang({ langTest: 'opic', langScore: 'IL' }), false);
  assert.strictEqual(lang({ langTest: 'opic', langScore: 'IM1' }), true);
  assert.strictEqual(lang({ langTest: 'toeicSpeaking', langScore: '110' }), false);
  assert.strictEqual(lang({ langTest: 'toeicSpeaking', langScore: '120' }), true);
  assert.strictEqual(lang({ langTest: 'gtelp', langScore: '50' }), true);
  assert.strictEqual(lang({ langTest: 'newTeps', langScore: '226' }), false);
  // 다른 시험을 고르면 예전에 넣은 TOEIC 점수는 공인외국어 판정에 쓰지 않는다
  assert.strictEqual(lang({ langTest: 'toefl', toeic: 700 }), false);
  assert.strictEqual(lang({ langRoutes: ['englishCourses'] }), true);
  assert.strictEqual(lang({ lang: 'P' }), true);
});

test('성적표 붙여넣기: 학수번호·별칭으로 찾고, 성적 없으면 수강 중, 전적대 인정 학점은 영역별로', () => {
  const text = [
    '2025-0 전적대학인정학점공통교양', '[9900000001]', '28',
    '2025-0 전적대학인정학점계열교양', '[9900000002]', '12',
    '2025-0 전적대학인정학점자유[9900000004', ']', '25',
    '2025-2 _식품유통경제학[553110] 3 P',
    '2026-1 바이오헬스인간과질병[548150] 2 P',
    '2026-2 환경경제학[438630] 3',
    '2026-2 무슨과목[123456] 3 P',
  ].join('\n');
  const { found, unmatched, transfer } = E.parseTranscript(R, text);
  assert.deepStrictEqual(transfer, { gen: 28, base: 12, free: 25 });
  assert.deepStrictEqual(found.map((f) => [f.id, f.status]), [['F-1', 'done'], ['M-2', 'done'], ['D-1', 'inprogress']]);
  assert.deepStrictEqual(unmatched.map((u) => [u.code, u.credits, u.status]), [['123456', 3, 'done']]);
});

test('추천안: 일반·편입, 트랙 조합별로 학점 한도 안에서 모든 학점·트랙 요건을 채운다', () => {
  for (const studentType of ['regular', 'transfer']) {
    for (const tracks of [[], ['BIO'], ['REG', 'BIO'], ['MKT', 'ECON']]) {
      const profile = { ...regular, studentType, tracks, transferCredits: { gen: 28, base: 12, free: 25 }, remainingSemesters: studentType === 'regular' ? 8 : 4 };
      const pl = E.plan(R, profile, []);
      const v = E.validatePlan(R, profile, [], pl);
      assert.deepStrictEqual(v.warnings.filter((w) => w.level === 'error').map((w) => w.text), [], `${studentType} ${tracks}`);
    }
  }
});

test('남은 학기가 없는데 부족하면 추가 학기가 필요하다고 경고한다', () => {
  const profile = { ...regular, remainingSemesters: 0 };
  const pl = E.plan(R, profile, []);
  const v = E.validatePlan(R, profile, [], pl);
  assert.ok(v.warnings.some((w) => w.text.includes('추가 학기가 필요')));
});

test('계획에서 타과 과목을 빼면 트랙 미이수와 전공 인정 불가를 경고한다', () => {
  const profile = { ...regular, tracks: ['BIO'] };
  const pl = E.plan(R, profile, []);
  for (const s of pl.semesters) {
    pl.unassigned.push(...s.items.filter((e) => e.id.startsWith('M-')));
    s.items = s.items.filter((e) => !e.id.startsWith('M-'));
  }
  const v = E.validatePlan(R, profile, [], pl);
  assert.ok(v.warnings.some((w) => w.text.includes('트랙 미이수') && w.text.includes('전공으로 인정되지 않습니다')));
});

test('학기당 한도: 기본 19 + (성적초과 3 또는 혁신융합 3, 중복 불가) + 이월 최대 3 − 산업체현장실습 (학사종합안내)', () => {
  const cap = (profile, i, items, prev) => E.semesterCap(R, { ...regular, ...profile }, i, items, prev).cap;
  const m = ids('planned', 'M-1');
  assert.strictEqual(cap({}, 0, [], 19), 19);
  assert.strictEqual(cap({}, 0, [], 18), 20);
  assert.strictEqual(cap({}, 0, [], 13), 22); // 이월은 최대 3
  assert.strictEqual(cap({}, 0, [], 9), 19); // 직전 학기가 최저 12학점 미만이면 이월 없음
  assert.strictEqual(cap({ bonus: { gpaHigh: true } }, 0, [], 19), 22);
  assert.strictEqual(cap({ bonus: { gpaHigh: true } }, 1, [], 19), 19); // 성적초과는 직전 학기 평점을 아는 첫 학기만
  assert.strictEqual(cap({ tracks: [] }, 1, m, null), 22); // 혁신융합은 트랙과 관계없음
  assert.strictEqual(cap({ bonus: { gpaHigh: true } }, 0, m, 19), 22); // 성적초과 대상자는 혁신추가학점 없음
  assert.strictEqual(cap({ bonus: { gpaHigh: true } }, 0, m, 16), 25); // 성적초과 + 이월 = 최대 25 (예시표)
  assert.strictEqual(cap({}, 0, m, 16), 25); // 혁신 + 이월 = 최대 25
  assert.strictEqual(cap({ bonus: { fieldPractice: 2 } }, 0, [], 19), 17); // 현장실습 학점만큼 차감
});

test('이월: 이번 학기 학점은 입력값, 없으면 수강 중 과목 합계. 계획 검사는 앞 학기 배치로 다음 학기 이월을 계산', () => {
  const taken = ids('inprogress', 'D-1', 'K-2');
  assert.strictEqual(E.currentLoad(R, regular, taken), 6);
  assert.strictEqual(E.currentLoad(R, { ...regular, bonus: { currentLoad: 18 } }, taken), 18);
  const pl = { semesters: [{ label: '2027-1', items: ids('planned', 'C-2', 'C-3', 'E-1', 'F-2', 'K-1') }, { label: '2027-2', items: [] }], unassigned: [] };
  const v = E.validatePlan(R, { ...regular, bonus: { currentLoad: 19 } }, [], pl);
  assert.deepStrictEqual(v.caps.map((c) => c.cap), [19, 22]);
});

test('최저 수강학점: 마지막 학기가 아니면 12학점, 마지막 학기는 6학점 미만일 때 경고', () => {
  const pl = { semesters: [{ label: '2027-1', items: ids('planned', 'C-2', 'C-3') }, { label: '2027-2', items: ids('planned', 'C-1') }], unassigned: [] };
  const w = E.validatePlan(R, regular, [], pl).warnings.filter((x) => x.level === 'warn').map((x) => x.text);
  assert.ok(w.some((t) => t.startsWith('2027-1') && t.includes('12학점')));
  assert.ok(w.some((t) => t.startsWith('2027-2') && t.includes('6학점')));
});

test('사회봉사: 32시간 = 온라인특강(강좌당 2시간, 1강좌 이상 필수) + 현장 + 교내(최대 10) + 헌혈(1회 4시간)', () => {
  const svc = (extra, curriculum = 'C24') => req(E.evaluate(R, { ...regular, curriculum, extra }, [], 'now'), 'SERVICE').satisfied;
  assert.strictEqual(svc({}), false);
  assert.strictEqual(svc({ service: 'P' }), true);
  assert.strictEqual(svc({ serviceLectures: 1, serviceFieldHours: 30 }), true);
  assert.strictEqual(svc({ serviceLectures: 0, serviceFieldHours: 40 }), false); // 온라인특강 필수
  assert.strictEqual(svc({ serviceLectures: 3, serviceFieldHours: 26 }), true); // 3강좌 6시간
  assert.strictEqual(svc({ serviceLectures: 4, serviceFieldHours: 24 }), false); // 3회까지만 인정
  assert.strictEqual(svc({ serviceLectures: 3, serviceFieldHours: 26 }, 'C25'), false); // 25학번은 1강좌
  assert.strictEqual(svc({ serviceLectures: 1, serviceFieldHours: 12, serviceCampusHours: 15, serviceBlood: 2 }), true); // 2+12+10(상한)+8 = 32
});

test('교양: 일반 재학생은 학번별 이수기준표(34/30/28), 편입생은 전적대 일괄 인정 기준 28', () => {
  const gen = (curriculum, studentType) => req(E.evaluate(R, { ...regular, curriculum, studentType }, [], 'now'), 'GEN').needed;
  assert.deepStrictEqual(['C23', 'C24', 'C25'].map((c) => gen(c, 'regular')), [34, 30, 28]);
  assert.deepStrictEqual(['C23', 'C24', 'C25'].map((c) => gen(c, 'transfer')), [28, 28, 28]);
});

test('현장실습·인턴십은 전공선택으로 인정되고 추천안에는 넣지 않는다. G-2는 사회적경제론(구 명칭으로도 찾음)', () => {
  const ev = E.evaluate(R, regular, ids('done', 'P-1'), 'now');
  assert.strictEqual(req(ev, 'ELEC').earned, 2);
  const pl = E.plan(R, { ...regular, remainingSemesters: 8 }, []);
  assert.ok(!pl.picked.some((p) => String(p.id).startsWith('P-')));
  // 사회적경제론은 2026 신설 — 애그리비즈니스(폐지, 환경경영론과 동일교과목)와 다른 과목
  assert.strictEqual(E.findCourse(R, { name: '애그리비즈니스' }).id, 'G-4');
  assert.strictEqual(E.findCourse(R, { name: '사회적경제론' }).id, 'G-2');
  assert.ok(R.courses.find((c) => c.id === 'G-4').noAutoPlan);
});

// 2026학년도 학사종합안내에서 그대로 옮긴 줄 (PDF 텍스트 추출 시 띄어쓰기·줄바꿈이 섞여도 맞아야 함)
const HANDBOOK_TEXT = `2026학년도
학사종합안내
- 일반학과 1~4학년(2013학년도 입학자부터)
19학점 이내
 ※ 매학기 최저 수강신청학점은 12학점(최종학기 6학점)이며,
 [직전 학기 성적이 4.0 이상인 학생은 3학점 초과신청 가능함(의·치·약학대학 제외)]
 마. 혁신추가학점: 혁신융합대학(바이오헬스,글로벌K-컬처, 차세대디스플레이, 단국 C-앵커) 교과목 신
청 시 최대수강가능학점 안내
혁신융합대학 교과목 신청자 최대수강가능학점
② 이월가능학점：3학점 이내
③ 학기제 적용으로 수강신청 이월학점을 다음 학기(다음연도 또는 복학학기)에 수강하지 않을 경우 자동 소멸됨
 가. 학점은 방학 중 실습기간과 동일한 계절학기학점으로 인정되며, 차기 학기에 이수학점만큼 최대수강
학점에서 제외됨.
 라. 전공선택으로 인정되며 성적은 P(이수), F(미이수)로 처리하여 전체 평점평균에는 포함하지 않음
ㆍ32시간(현장봉사 + 온라인특강) 이수(전 재학생 해당)
(강좌당 봉사시간 2시간 부여)
 2) 2012학년도 입학자부터는 교내 봉사시간이 최대 10시간까지만 인정됨(1일 최대 8시간 인정)
 1) 헌혈은 1회당 4시간으로 인정하며
심화전공과정 63 이상 (식품공학)은 공학일반교육과정을 69학점으로 운영함
졸업요구학점 130학점 이상(대학/학과별 졸업요구학점)
식품자원경제학과
-학부(과)기초(18학점)가 학문기초(12학점)로 편성 조
정됨에 따라 2024학년도 입학생까지 학부(과)기초
이수기준은 18학점에서 12학점으로 하향조정
가. 식품자원경제학과 (개설년도：2024학년도)
G-2. 사회적경제론(3)`;

test('기준 문서: 2026 학사종합안내 본문이면 학년도와 모든 기준 문구가 확인된다', () => {
  const r = E.checkHandbook(R, HANDBOOK_TEXT);
  assert.strictEqual(r.year, 2026);
  assert.deepStrictEqual(r.checks.filter((c) => !c.ok).map((c) => [c.id, c.missing]), []);
  assert.ok(r.ok);
});

test('기준 문서: 다른 학년도이거나 기준 문구가 바뀌면 알려준다', () => {
  const next = E.checkHandbook(R, HANDBOOK_TEXT.replace('2026학년도', '2027학년도'));
  assert.strictEqual(next.year, 2027);
  assert.strictEqual(next.yearOk, false);
  const changed = E.checkHandbook(R, HANDBOOK_TEXT.replace('19학점 이내', '21학점 이내'));
  assert.deepStrictEqual(changed.checks.filter((c) => !c.ok).map((c) => c.id), ['maxcr']);
  assert.strictEqual(E.checkHandbook(R, '아무 문서').year, null);
});

// 포털 「학점이수 자가진단 시뮬레이션」 내보내기 PDF 본문 (이름·학번 제거). 본인 케이스(cases/self-2023.json)와 같은 학생
const SIM_TEXT = `학점이수 자가진단 시뮬레이션 - 2023
성명 학번 학년-학기 4-2 재학 이수학기수 3 공학인증
소속 공공·보건과학대학 환경자원경제학과 입학구분(입학년도) 편입학(2025)
1전공 공공·보건과학대학 환경자원경제학과(심화과정) 편입학 인정 학기 수 4 학점 수 65
졸업논문 통과여부 1전공 N
2부전공 공인외국어 P/F F
마이크로1전공 사회봉사 P/F P(시간이수)
주전공 교양과정_공통 28 0 0 0 0 0 P
주전공 ≫ 대학영어1 0 0 0 0 0 0
주전공 ≫ 대학영어2 0 0 0 0 0 0
주전공 교양과정_영역 0 0 0 0 0 0
주전공 ≫ 영역별교양 0 0 0 0 0 0 P
주전공 ≫ 문학/역사/철학 0 0 0 0
주전공 교양과정_일반 0 0 0 0 0 0
주전공 교양과정_최저학점 28 0 28 1 0 0 P
주전공 학과(부)기초 12 0 12 1 0 0 P
주전공 심화전공_전공필수 15 0 12 4 0 0 3 N
주전공 심화전공_전공선택 48 0 33 11 6 2 9 N
주전공 심화전공_최저학점 63 0 45 15 6 2 12 N
주전공 교직 0 0 0 0 0 0
주전공 자유 0 0 34 5 6 3 2
전공구분 이수 영역 기준 취득 수강신청 부족 통과 여부 재수강
주전공 졸업최저학점 130 0 119 22 12 5 N 2
총 취득학점 : 131
영역별 이수 교과목 현황
이수교양
공교필수
2025-0 전적대학인정학점공통교양
[9900000001]
28
이수전공
학과기초
2025-0 전적대학인정학점계열교양
[9900000002]
12
전공필수
2025-2 _식품유통경제학[553110] 3 P
2025-2 _마케팅조사분석[534890] 3 P
2025-2 _미시경제학[345790] 3 P
2026-1 _거시경제학[303540] 3 P
전공선택
2025-1 소비자경제학[553100] 3 P
2025-1 경제가치분석[553120] 3 P
2025-1 식품위생법사례분석[553770] 3 P
2025-1 협동조합론[436280] 3 P
2025-2 지속가능발전론[411210] 3 P
2025-2 통계학기초[446440] 3 P
2025-2 지역정책[459750] 3 P
2026-1 유통관리론[446410] 3 P
2026-1 신제품개발프로세스[553780] 3 P
2026-1 식품안전경제학[534900] 3 P
2026-1 지역발전론[479170] 3 P
자유선택
2025-0 전적대학인정학점자유[9900000004
]
25
2025-1 영양학[378800] 3 P
2026-1 바이오헬스인간과질병[548150] 2 P
2026-1 미래식품과다이어트[548750] 2 P
2026-1 식품저장학[369590] 2 P
수강전공
[수강]전공선택
2026-2 환경경제학[438630] 3
2026-2 경영계획법[553740] 3
[수강]자유선택
2026-2 바이오헬스인체의신비[541980] 2
2026-2 관능검사[312930] 2
2026-2 바이오헬스기초의학[541990] 2
재이수전공
자유선택
2026-1 바이오헬스인체의신비[541980] 2 P`;

test('시뮬레이션 PDF: 머리글(교육과정·학년학기·편입·사회봉사·공인외국어)과 영역별 표를 읽는다', () => {
  const s = E.parseSimulation(R, SIM_TEXT);
  assert.deepStrictEqual([s.baseYear, s.curriculum, s.studentType, s.entryYear, s.year, s.term, s.service, s.lang, s.thesis], [2023, 'C23', 'transfer', 2025, 4, 2, 'P', 'F', 'N']);
  const row = (n) => s.rows.find((r) => r.name === n);
  assert.deepStrictEqual(row('심화전공_전공필수'), { name: '심화전공_전공필수', label: '전공필수', req: 'REQ', std: 15, earned: 12, enrolled: 0, pass: 'N', lack: 3, retake: null, subs: [] });
  assert.strictEqual(row('자유').retake, 2);
  assert.strictEqual(row('졸업최저학점').retake, 2);
  assert.strictEqual(row('교양과정_공통').pass, 'P');
  assert.ok(!s.rows.some((r) => r.name.includes('대학영어')));
  assert.strictEqual(E.parseSimulation(R, '아무 문서'), null);
});

testSelf('시뮬레이션 PDF: 뒤에 붙은 교과목 현황으로 본인 케이스와 같은 과목·전적대 학점을 얻는다', () => {
  const t = E.parseSimulation(R, SIM_TEXT).transcript;
  assert.deepStrictEqual(t.transfer, { gen: 28, base: 12, free: 25 });
  const got = []; const seen = new Set();
  for (const f of t.found) if (!seen.has(f.id)) { seen.add(f.id); got.push(`${f.id}:${f.status}`); }
  assert.deepStrictEqual(got.sort(), self.taken.map((x) => `${x.id}:${x.status}`).sort());
  assert.deepStrictEqual(t.unmatched, []);
});

test('성적표: 학과 교과목이 아닌 과목은 위에 있는 영역 제목(공교필수·학과기초·전공·자유선택)을 따른다', () => {
  const { unmatched } = E.parseTranscript(R, '공교필수\n2024-1 대학영어1[111111] 2 P\n학과기초\n2024-1 다른학과기초[222222] 3 P\n전공선택\n2024-2 타학과전공[333333] 3 P\n자유선택\n2024-2 아무과목[444444] 2 P');
  assert.deepStrictEqual(unmatched.map((u) => u.area), ['gen', 'base', 'major', 'free']);
});

testSelf('포털 대조: 학과 공지 20~23학번 전공필수 5과목(15학점) 기준이면 전공필수까지 포털 시뮬레이션과 같다', () => {
  const rows = E.comparePortal(R, self.profile, self.taken, E.parseSimulation(R, SIM_TEXT).rows);
  const by = Object.fromEntries(rows.map((r) => [r.req, r.same]));
  assert.deepStrictEqual([by.MAJOR, by.TOTAL, by.GEN, by.BASE, by.REQ], [true, true, true, true, true]);
});

testTrack('붙임2 「기타」 과목: 캡스톤디자인·취창업진로세미나(구 명칭 취창업전공세미나)도 찾는다', () => {
  assert.strictEqual(E.findCourse(R, { name: '취창업전공세미나1' }).id, 'P-7');
  assert.strictEqual(E.findCourse(R, { name: '캡스톤디자인2' }).credits, 3);
});

// 붙임2 최신판 PDF를 pdf.js로 추출한 본문 (docs/sources/붙임2-모듈형교육과정-식품자원경제학과.pdf)

testTrack('트랙 자료: 붙임2 최신판 본문이면 트랙 기준 문구가 모두 확인된다', () => {
  const r = E.checkTrackDoc(R, TRACK_TEXT);
  assert.deepStrictEqual(r.checks.filter((c) => !c.ok).map((c) => [c.id, c.missing]), []);
  assert.strictEqual(E.checkTrackDoc(R, TRACK_TEXT.replaceAll('최소   6 학점', '최소   9 학점')).checks.find((c) => c.id === 'dept').ok, false);
});

testTrack('문서 구분: 시뮬레이션 출력 / 학사종합안내 / 트랙 교육과정 / 그 외', () => {
  assert.deepStrictEqual([SIM_TEXT, HANDBOOK_TEXT, TRACK_TEXT, '아무 문서'].map(E.classifyDoc), ['simulation', 'handbook', 'track', null]);
});

test('성적표: PDF에서 띄어쓰기가 모두 사라지거나 하이픈이 다른 기호로 나와도 같은 과목·학점·상태를 읽는다', () => {
  const spaced = E.parseSimulation(R, SIM_TEXT).transcript;
  const squashed = E.parseTranscript(R, SIM_TEXT.replace(/\s+/g, '').replace(/(20\d\d)-/g, '$1–'));
  assert.deepStrictEqual(squashed.transfer, spaced.transfer);
  assert.deepStrictEqual(squashed.found.map((f) => `${f.id}:${f.status}`), spaced.found.map((f) => `${f.id}:${f.status}`));
  const one = E.parseTranscript(R, '2026-2환경경제학[438630]32026-2경영계획법[553740]3[수강]자유선택2026-1바이오헬스인체의신비[541980]2C+');
  assert.deepStrictEqual(one.found.map((f) => `${f.id}:${f.status}`), ['D-1:inprogress', 'K-2:inprogress', 'M-1:done']);
});

testSelf('기준 학기: 그 학기를 포함한 이전 과목만, 그 학기 과목은 수강 중(또는 이수로), 재수강은 기준 학기까지의 마지막 기록', () => {
  const t = E.parseSimulation(R, SIM_TEXT).transcript;
  const sim = [...t.found.map((f) => ({ id: f.id, status: f.status, term: f.term })), ...t.unmatched.map((u) => ({ custom: true, id: 'X-' + u.code, code: u.code, status: u.status, term: u.term }))];
  const at = (asOf, asOfDone) => E.coursesAsOf(sim, asOf, { asOfDone }).map((e) => `${e.id}:${e.status}`).sort();
  assert.deepStrictEqual(at(null), self.taken.map((x) => `${x.id}:${x.status}`).sort()); // 현재 = 전체
  assert.deepStrictEqual(at('2025-1'), ['C-2:inprogress', 'I-3:inprogress', 'K-1:inprogress', 'L-1:inprogress', 'N-2:inprogress']);
  assert.deepStrictEqual(at('2025-1', true), ['C-2:done', 'I-3:done', 'K-1:done', 'L-1:done', 'N-2:done']);
  const s26 = E.coursesAsOf(sim, '2026-1', { asOfDone: true });
  assert.strictEqual(s26.find((e) => e.id === 'M-1').status, 'done'); // 2026-1 첫 수강 기록 (2026-2 재수강은 제외)
  assert.ok(!s26.some((e) => e.id === 'D-1')); // 2026-2 환경경제학 제외
  assert.strictEqual(E.termDiff('2026-2', '2025-1'), 3);
});

test('입학년도 → 적용 교육과정: 일반은 입학년도, 편입생은 편입년도 − (편입 학년 − 1)', () => {
  const cur = (studentType, entryYear, transferGrade) => E.curriculumForProfile(R, { studentType, entryYear, transferGrade });
  assert.deepStrictEqual([cur('regular', 2019), cur('regular', 2016), cur('regular', 2023), cur('regular', 2024), cur('regular', 2026)], ['C19', 'C17', 'C23', 'C24', 'C25']);
  assert.strictEqual(E.cohortYear({ studentType: 'transfer', entryYear: 2025, transferGrade: 3 }), 2023);
  assert.strictEqual(cur('transfer', 2025, 3), 'C23');
  assert.strictEqual(cur('transfer', 2026, 3), 'C24');
  assert.strictEqual(cur('transfer', 2025, 2), 'C24');
  assert.strictEqual(cur('transfer', 2015, 3), null); // 13학번 — 지원 안 함
  assert.strictEqual(cur('regular', null), null);
});

test('바꿔 들을 수 있는 과목: 같은 학점·같은 학기로 같은 기준을 채울 때만, 필수 과목은 대안 없음', () => {
  const p = { ...regular, curriculum: 'C24', tracks: ['REG', 'MKT'], remainingSemesters: 3 };
  const taken = ['B-2', 'C-1', 'D-1'].map((id) => ({ id, status: 'done' }));
  const pl = E.plan(R, p, taken);
  const alts = E.alternatives(R, p, taken, pl);
  const placed = new Map(pl.semesters.flatMap((s) => s.items.map((e) => [e.id, Number(s.label.slice(-1))])));
  for (const id of ['C-2', 'C-3', 'F-1', 'H-1']) assert.ok(!alts[id], id); // 모듈 내 필수
  for (const [id, list] of Object.entries(alts)) {
    const c = R.courses.find((x) => x.id === id);
    for (const a of list) {
      const y = R.courses.find((x) => x.id === a);
      assert.strictEqual(y.credits, c.credits);
      assert.ok(!placed.has(a) && !taken.some((t) => t.id === a), a); // 이미 들었거나 계획에 있는 과목은 대안 아님
      if (placed.has(id) && y.offered.length) assert.ok(y.offered.includes(placed.get(id)), `${a} 표준 학기`);
      // 바꿔도 트랙·졸업 기준이 그대로 충족
      const swapped = [...taken, ...[...placed.keys()].map((x) => ({ id: x === id ? a : x, status: 'planned' })), ...pl.unassigned.map((e) => ({ ...e, status: 'planned' }))];
      const ev = E.evaluate(R, p, swapped, 'plan');
      assert.ok(ev.tracks.every((t) => t.satisfied), `${id}→${a}`);
    }
  }
  // 지역발전론(E-1) 자리는 같은 1학기 E 모듈 커뮤니티발전론만 대신할 수 있다
  if (alts['E-1']) assert.deepStrictEqual(alts['E-1'], ['E-3']);
});

test('남은 기준 정리: 영역별 남은 학점, 트랙 기준별 남은 학점과 채울 과목, 꼭 들어야 할 과목', () => {
  const p = { ...regular, curriculum: 'C24', tracks: ['REG'] };
  const n = E.remainingNeeds(R, p, ['B-2', 'C-1', 'D-1'].map((id) => ({ id, status: 'done' })));
  assert.deepStrictEqual(n.credits.find((c) => c.id === 'MAJOR'), { id: 'MAJOR', name: '전공 최저학점', needed: 63, earned: 9, left: 54 });
  const d = n.tracks[0].parts.find((x) => x.label.startsWith('D'));
  assert.deepStrictEqual([d.earned, d.left, d.options], [3, 3, ['D-2', 'D-3']]);
  assert.deepStrictEqual(n.must.map((m) => m.id), ['C-2', 'C-3', 'F-1', 'H-1']);
});

test('교양 세부: 시뮬레이션의 ≫ 세부 줄을 영역에 붙이고, 기준이 있는 영역의 남은 학점·못 채운 세부 항목을 낸다', () => {
  const s = E.parseSimulation(R, `학점이수 자가진단 시뮬레이션 - 2024
주전공 교양과정_공통 18 0 12 1 3 0 N
주전공 ≫ 대학영어1 2 0 2 1 0 0 P
주전공 ≫ 대학영어2 2 0 0 0 0 0 N
주전공 교양과정_영역 12 0 12 4 0 0 P
주전공 ≫ 영역별교양 0 0 0 0 0 0 P
주전공 교양과정_최저학점 30 0 24 5 3 0 N`);
  assert.deepStrictEqual(E.genDetail(s.rows), [
    { label: '공통교양', std: 18, have: 15, left: 3, subsLeft: ['대학영어2'] },
    { label: '영역교양', std: 12, have: 12, left: 0, subsLeft: [] },
  ]);
  // 편입생처럼 세부 기준이 0이면 세부 없음 (SIM_TEXT의 교양과정_영역 0)
  assert.ok(E.genDetail(E.parseSimulation(R, SIM_TEXT).rows).every((g) => g.label !== '영역교양'));
});

test('F·NP는 이수로 보지 않는다: 판정에서 빠지고, 필수 과목이면 수강 계획에 재수강으로 다시 들어간다', () => {
  const t = E.parseTranscript(R, '전공선택\n2025-1 _유통관리론[446410] 3 F\n2025-2 _마케팅조사분석[534890] 3 NP\n2025-2 _협동조합론[436280] 3 P\n이수교양\n2024-1 글쓰기[123456] 3 F');
  assert.deepStrictEqual(t.found.map((f) => [f.id, f.status]), [['F-2', 'failed'], ['H-1', 'failed'], ['K-1', 'done']]);
  assert.strictEqual(t.unmatched[0].status, 'failed');
  const p = { ...regular, curriculum: 'C24', remainingSemesters: 4 };
  const ev = E.evaluate(R, p, t.found, 'predict');
  assert.ok(!ev.items.some((i) => i.cid === 'F-2' || i.cid === 'H-1'));
  assert.ok(ev.requirements.find((r) => r.kind === 'allOf').missing.includes('H-1'));
  const pl = E.plan(R, p, t.found);
  assert.ok(pl.picked.some((e) => e.id === 'H-1')); // F 받은 필수 과목은 재수강으로 계획에 들어간다
  // 같은 과목을 나중에 통과하면 마지막 기록(통과)을 쓴다
  const later = E.coursesAsOf([...t.found, { id: 'F-2', status: 'done', term: '2026-1' }], null);
  assert.strictEqual(later.find((e) => e.id === 'F-2').status, 'done');
});

test('추천 시간표 순위: 1번은 최소 학점이고, 효율 점수(미배정·개설 학기·필수 순서·학기 고름)가 가장 좋다', () => {
  const taken = ['A-1', 'A-2', 'B-1', 'B-2', 'C-1', 'C-2', 'D-1', 'E-1'].map((id) => ({ id, status: 'done' }));
  for (const [cur, tracks] of [['C24', []], ['C24', ['BIO']], ['C23', ['ECON', 'DIST', 'MKT']]]) {
    const p = { ...regular, curriculum: cur, tracks, remainingSemesters: 4 };
    const list = E.rankedPlans(R, p, taken);
    assert.ok(list.length >= 1);
    const scores = list.map((pl) => E.planScore(R, p, pl));
    // 모두 같은 최소 학점, 그리고 점수 순서대로 정렬
    assert.ok(scores.every((x) => x[0] === scores[0][0]));
    for (let i = 1; i < scores.length; i++) {
      const a = scores[i - 1], b = scores[i];
      const k = a.findIndex((v, j) => v !== b[j]);
      assert.ok(k < 0 || a[k] < b[k], `${cur} ${i}`);
    }
    // 기본 추천(seed 0)보다 학점이 많지 않다
    assert.ok(scores[0][0] <= E.plan(R, p, taken).neededCredits);
  }
});

test('초과학기: 9학기 이상 등록한 다음 학기에는 학점 이월이 없다 (학사종합안내 [3.주요학사제도] p.2)', () => {
  const p = { ...regular, curriculum: 'C24', bonus: {}, maxCredits: 19 };
  // 7학기 중 15학점 → 8학기 한도에 이월 +3
  assert.strictEqual(E.semesterCap(R, { ...p, semesterNo: 7 }, 0, [], 15).cap, 22);
  // 9학기(초과학기) 중 15학점 → 10학기 한도에 이월 없음
  assert.strictEqual(E.semesterCap(R, { ...p, semesterNo: 9 }, 0, [], 15).cap, 19);
  // 8학기 중이면 계획 둘째 학기(10학기, 직전 9학기)부터 이월 없음
  assert.strictEqual(E.semesterCap(R, { ...p, semesterNo: 8 }, 1, [], 15).cap, 19);
  assert.strictEqual(E.semesterCap(R, { ...p, semesterNo: 8 }, 0, [], 15).cap, 22);
});
