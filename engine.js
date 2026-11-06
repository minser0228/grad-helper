// 졸업요건·트랙 판정과 수강 계획 엔진 (규칙 기반, DOM 의존 없음 — 브라우저와 Node 모두에서 동작).
//
// 판정 모드
//   now     : 이수 완료 과목만, 트랙 전공 인정 미반영 (포털 졸업사정과 같은 시점)
//   predict : 이수 + 수강 중 과목, 트랙 이수 완료 시 타과 과목 전공 인정 반영
//   plan    : 이수 + 수강 중 + 계획 과목, 전공 인정 반영
(function (root) {
  const MODES = {
    now: { statuses: ['done'], conversion: false },
    predict: { statuses: ['done', 'inprogress'], conversion: true, assumeTracks: true },
    predictStrict: { statuses: ['done', 'inprogress'], conversion: true },
    plan: { statuses: ['done', 'inprogress', 'planned'], conversion: true, assumeTracks: true },
  };
  const AREAS = { major: '전공', gen: '교양', base: '학과기초', free: '자유선택' };

  function catalog(rules) {
    const map = {};
    for (const c of rules.courses) map[c.id] = c;
    return map;
  }

  const norm = (s) => String(s).replace(/^_/, '').replace(/\s+/g, '');

  // 이름·학수번호로 교과목 찾기 (성적표의 "_미시경제학", "바이오헬스인체의신비" 같은 표기 포함)
  function findCourse(rules, { name, code }) {
    if (code) {
      const byCode = rules.courses.find((c) => c.code === String(code));
      if (byCode) return byCode;
    }
    if (name) {
      const n = norm(name);
      return rules.courses.find((c) => norm(c.name) === n || [...(c.aliases || []), ...(c.formerNames || [])].some((a) => norm(a) === n)) || null;
    }
    return null;
  }

  // 교과목의 이수 영역: 학과 전공 → major, 타과 융합 → other(트랙 인정 전에는 자유선택), 학문기초 → base
  const courseKind = (rules, c) => rules.modules[c.module].kind;

  // 항목: { id, status } (교과목) 또는 { custom: true, id, name, credits, area, status }
  function resolveEntry(entry, cat, rules) {
    const status = entry.status || 'done';
    if (entry.custom) {
      const area = entry.area || (entry.major ? 'major' : 'free');
      return { key: entry.id, cid: null, name: entry.name, credits: Number(entry.credits) || 0, module: null, kind: area, status, custom: true };
    }
    const c = cat[entry.id];
    if (!c) return { key: entry.id, cid: entry.id, name: `알 수 없는 과목 (${entry.id})`, credits: 0, module: null, kind: 'free', status, unknown: true };
    return { key: c.id, cid: c.id, name: c.name, credits: c.credits, module: c.module, kind: courseKind(rules, c), status, term: entry.term || null };
  }

  function entryKey(e) { return e.id; }

  // 편입생 전적대 인정 학점을 영역별 항목으로
  function transferItems(rules, profile) {
    if (profile.studentType !== 'transfer') return [];
    const tc = profile.transferCredits || {};
    return rules.transferAreas.filter((a) => Number(tc[a.key]) > 0).map((a) => ({
      key: 'TR-' + a.key, cid: null, name: `전적대 인정 (${a.label})`, credits: Number(tc[a.key]), module: null, kind: a.key, status: 'done', transfer: true,
    }));
  }

  function itemsFor(rules, entries, statuses) {
    const cat = catalog(rules);
    const seen = new Set();
    const out = [];
    for (const e of entries) {
      const r = resolveEntry(e, cat, rules);
      if (!statuses.includes(r.status) || r.unknown || seen.has(r.key)) continue;
      seen.add(r.key);
      out.push(r);
    }
    return out;
  }

  const sum = (items) => items.reduce((s, i) => s + i.credits, 0);

  // 여유 학점이 수강 중·계획 과목 하나보다 작으면, 그 과목을 못 들었을 때 깨진다
  function fragility(counted, slack) {
    const risky = counted.filter((i) => i.status !== 'done' && i.credits > slack);
    return risky.length ? { slack, risky: risky.map((i) => i.name) } : null;
  }

  function evalTrack(rules, trackId, items) {
    const t = rules.tracks[trackId];
    const parts = t.parts.map((p) => {
      const counted = items.filter((i) => i.module && p.modules.includes(i.module));
      const earned = sum(counted);
      const label = p.label || p.modules.map((m) => `${m} ${rules.modules[m].name}`).join('·');
      const satisfied = earned >= p.min;
      return { label, modules: p.modules, min: p.min, earned, counted, satisfied, fragile: satisfied ? fragility(counted, earned - p.min) : null };
    });
    const have = new Set(items.map((i) => i.cid));
    const commonMissing = rules.trackCommonRequired.courses.filter((c) => !have.has(c));
    const satisfied = parts.every((p) => p.satisfied) && commonMissing.length === 0;
    return { id: trackId, name: t.name, type: t.type, parts, commonMissing, satisfied, convertsToMajor: t.convertsToMajor || [] };
  }

  // 졸업시험: 합격 또는 면제 요건 중 하나
  function examPaths(rules, extra) {
    const paths = [];
    if (extra.examPassed) paths.push('졸업시험 합격');
    if (Number(extra.toeic) >= rules.examExemptToeic) paths.push(`TOEIC ${rules.examExemptToeic} 이상 면제`);
    if (extra.contest) paths.push('외부 경연대회 입상 면제 (교수 승인)');
    if (extra.journal) paths.push('전문학술지 게재 면제');
    if (Number(extra.points) >= rules.examExemptPoints) paths.push(`비교과 포인트 ${rules.examExemptPoints}점 이상 면제`);
    return paths;
  }

  // 공인외국어(졸업인증제): 포털 이수 표시 / 공인영어 시험 기준 / 시험 외 인정 방법 중 하나
  function langPaths(rules, extra) {
    const L = rules.languageCert, paths = [];
    if (extra.lang === 'P') paths.push('이수 (포털 확인)');
    const test = L.tests.find((t) => t.id === (extra.langTest || 'toeic'));
    const score = test && (test.id === 'toeic' ? extra.toeic : extra.langScore);
    if (test && score) {
      const pass = test.levels ? test.levels.indexOf(score) >= test.levels.indexOf(test.min) : Number(score) >= test.min;
      if (pass) paths.push(`${test.label} ${score}`);
    }
    for (const r of L.routes) if ((extra.langRoutes || []).includes(r.id)) paths.push(r.label);
    return paths;
  }

  // 사회봉사 시간: 온라인특강(강좌당 시간, 요건별 최대 강좌 수) + 현장봉사 + 교내봉사(상한) + 헌혈(회당 시간)
  function serviceHours(rules, req, extra) {
    const s = rules.service;
    const lecturesTaken = extra.serviceLectures != null ? Number(extra.serviceLectures) || 0 : (extra.serviceOnline ? 1 : 0);
    const lectures = Math.min(lecturesTaken, req.maxOnlineLectures || lecturesTaken);
    const online = lectures * s.hoursPerOnlineLecture;
    const field = Number(extra.serviceFieldHours != null ? extra.serviceFieldHours : extra.serviceHours) || 0;
    const campus = Math.min(Number(extra.serviceCampusHours) || 0, s.campusMaxHours);
    const blood = (Number(extra.serviceBlood) || 0) * s.bloodDonationHours;
    return { lectures, online, field, campus, blood, total: online + field + campus + blood };
  }

  function evaluate(rules, profile, entries, modeName = 'predict') {
    const mode = MODES[modeName];
    const cat = catalog(rules);
    const courseItems = itemsFor(rules, entries, mode.statuses);
    const items = [...transferItems(rules, profile), ...courseItems];
    const cur = rules.curricula[profile.curriculum];
    if (!cur) throw new Error(`교육과정을 찾을 수 없음: ${profile.curriculum}`);
    const extra = profile.extra || {};

    const tracks = (profile.tracks || []).slice(0, rules.maxTracks).filter((t) => rules.tracks[t]).map((t) => evalTrack(rules, t, courseItems));
    const converted = new Set();
    const assumed = [];
    if (mode.conversion) for (const t of tracks) {
      if (!t.satisfied && !mode.assumeTracks) continue;
      if (!t.satisfied && t.convertsToMajor.length) assumed.push(t.id);
      t.convertsToMajor.forEach((m) => converted.add(m));
    }
    const isMajor = (i) => i.kind === 'major' || (i.kind === 'other' && converted.has(i.module));
    const convertedItems = courseItems.filter((i) => i.kind === 'other' && converted.has(i.module));

    const requiredReq = cur.requirements.find((r) => r.kind === 'allOf');
    const requiredSet = new Set(requiredReq ? requiredReq.courses : []);
    // 대체 인정 (예: ~19학번은 2020~2023학년도에 이수한 마케팅조사분석을 계량경제학 대신 전공필수로 인정)
    const subUsed = {}, subUnknown = [];
    if (requiredReq) for (const sub of requiredReq.substitutes || []) {
      if (courseItems.some((i) => i.cid === sub.for)) continue;
      const alt = courseItems.find((i) => i.cid === sub.course);
      if (!alt) continue;
      const n = termNum(alt.term);
      if (n == null) subUnknown.push(sub);
      else if (n >= termNum(sub.fromTerm) && n <= termNum(sub.toTerm)) { subUsed[sub.for] = alt; requiredSet.add(sub.course); }
    }
    const usage = {};

    const requirements = cur.requirements.map((req) => {
      let counted = [], earned = 0, needed = 0, unit = '학점', satisfied = false, missing = [], note = null, sourceId = req.sourceId;
      if (req.kind === 'allOf') {
        counted = courseItems.filter((i) => requiredSet.has(i.cid));
        const have = new Set(counted.map((i) => i.cid));
        missing = req.courses.filter((c) => !have.has(c) && !subUsed[c]);
        const cname = (id) => (cat[id] ? cat[id].name : id);
        const notes = Object.entries(subUsed).map(([f, alt]) => `${alt.name}(${alt.term})을 ${cname(f)} 대신 인정`);
        for (const sub of subUnknown) notes.push(`${cname(sub.course)}을 ${sub.fromTerm.slice(0, 4)}~${sub.toTerm.slice(0, 4)}학년도에 들었다면 ${cname(sub.for)} 대신 인정 — 수강 학기가 없어 판단하지 못함`);
        if (notes.length) note = notes.join(' / ');
        unit = '과목';
        earned = req.courses.length - missing.length;
        needed = req.courses.length;
        satisfied = missing.length === 0;
      } else if (req.kind === 'majorElective') {
        counted = items.filter((i) => isMajor(i) && !requiredSet.has(i.cid));
        earned = sum(counted); needed = req.minCredits; satisfied = earned >= needed;
      } else if (req.kind === 'majorTotal') {
        counted = items.filter(isMajor);
        earned = sum(counted); needed = req.minCredits; satisfied = earned >= needed;
      } else if (req.kind === 'area') {
        counted = items.filter((i) => i.kind === req.area);
        const transferBasis = profile.studentType === 'transfer' && req.minCreditsTransfer != null;
        earned = sum(counted); needed = transferBasis ? req.minCreditsTransfer : req.minCredits; satisfied = earned >= needed;
        if (transferBasis) { sourceId = req.transferSourceId; note = `편입생 기준 (일반 재학생 ${req.minCredits}학점)`; }
      } else if (req.kind === 'total') {
        counted = items;
        earned = sum(items); needed = req.minCredits; satisfied = earned >= needed;
      } else if (req.kind === 'exam') {
        unit = '여부';
        const paths = examPaths(rules, extra);
        satisfied = paths.length > 0;
        earned = satisfied ? paths.join(', ') : '미통과';
        note = satisfied ? null : `면제: TOEIC ${rules.examExemptToeic} 이상 · 외부 경연대회 입상 · 학술지 게재 · 비교과 포인트 ${rules.examExemptPoints}점`;
      } else if (req.kind === 'lang') {
        unit = '여부';
        const paths = langPaths(rules, extra);
        satisfied = paths.length > 0;
        earned = satisfied ? paths[0] : '미충족';
        needed = 'TOEIC 600 등';
        note = satisfied ? null : '공인영어 시험 기준 또는 다른 인정 방법 중 하나';
      } else if (req.kind === 'service') {
        // 포털에 이수로 표시되면 그대로 인정, 아니면 시간 합산
        unit = '여부';
        const s = serviceHours(rules, req, extra);
        if (extra.service === 'P') { satisfied = true; earned = '이수 (포털 확인)'; }
        else {
          satisfied = s.lectures >= rules.service.minOnlineLectures && s.total >= rules.service.totalHours;
          earned = `${s.total} / ${rules.service.totalHours}시간 (온라인특강 ${s.lectures}강좌)`;
          if (!satisfied) note = [s.lectures < rules.service.minOnlineLectures && `온라인특강 ${rules.service.minOnlineLectures}강좌`, s.total < rules.service.totalHours && `봉사 ${rules.service.totalHours - s.total}시간`].filter(Boolean).join(' + ') + ' 더 필요';
        }
        needed = `${rules.service.totalHours}시간`;
      } else if (req.kind === 'pf') {
        unit = '여부';
        satisfied = (extra[req.id.toLowerCase()] || 'N') === 'P';
        earned = satisfied ? '이수' : '미이수';
      }
      for (const i of counted) (usage[i.key] = usage[i.key] || []).push(req.id);
      const fragile = satisfied && unit === '학점' ? fragility(counted, earned - needed) : null;
      return { ...req, sourceId, counted, earned, needed, unit, satisfied, missing, note, fragile };
    });

    const trackCommon = tracks.length ? {
      id: 'TRACK-COMMON', name: '트랙 공통 — 모듈 내 필수', courses: rules.trackCommonRequired.courses,
      missing: tracks[0].commonMissing, satisfied: tracks[0].commonMissing.length === 0, sourceId: rules.trackCommonRequired.sourceId,
    } : null;

    const majorReq = requirements.find((r) => r.kind === 'majorTotal');
    return {
      mode: modeName,
      items,
      tracks,
      trackCommon,
      converted: [...converted],
      assumedTracks: assumed, // 아직 기준을 다 채우지 않았지만 이수를 가정해 전공 인정한 트랙
      convertedCredits: sum(convertedItems),
      convertedItems,
      requirements,
      usage,
      majorEarned: majorReq ? majorReq.earned : 0,
      majorRequired: majorReq ? majorReq.needed : 0,
      allSatisfied: requirements.every((r) => r.satisfied) && tracks.every((t) => t.satisfied),
    };
  }

  // "2027-1" 부터 n개 학기 라벨
  function semesterLabels(start, n) {
    const m = /^(\d{4})-([12])$/.exec(start || '');
    if (!m) throw new Error(`시작 학기 형식 오류: ${start} (예: 2027-1)`);
    let y = Number(m[1]), t = Number(m[2]);
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push(`${y}-${t}`);
      if (t === 2) { y++; t = 1; } else t = 2;
    }
    return out;
  }
  const termOf = (label) => Number(label.split('-')[1]);

  function entryCredits(e, cat) { return e.custom ? Number(e.credits) || 0 : (cat[e.id] ? cat[e.id].credits : 0); }

  // 이번 학기(수강 중) 학점 — 다음 학기 이월 학점 계산용. profile.bonus.currentLoad가 있으면 그 값
  function currentLoad(rules, profile, entries) {
    const b = profile.bonus || {};
    if (b.currentLoad !== undefined && b.currentLoad !== null && b.currentLoad !== '') return Number(b.currentLoad) || 0;
    const cat = catalog(rules);
    return entries.filter((e) => e.status === 'inprogress').reduce((s, e) => s + entryCredits(e, cat), 0);
  }

  // 남은 학기 i의 수강 한도 = 기본 + 성적초과 또는 혁신추가(둘 중 하나) + 이월 − 산업체현장실습 학점 (S-BONUSCR, S-INTERN)
  // 성적초과·현장실습 차감은 직전 학기를 아는 첫 학기에만, 이월은 직전 학기 학점(첫 학기는 이번 학기, 이후는 계획)으로 계산.
  // prevLoad를 모르면(null) 이월을 0으로 본다. 직전 학기가 최저 수강학점 미만이면 이월 대상이 아니다.
  function semesterCap(rules, profile, i, items, prevLoad) {
    const base = Number(profile.maxCredits) || rules.maxCreditsPerSemester.value;
    const B = rules.creditBonus;
    const bonus = profile.bonus || {};
    const cat = catalog(rules);
    const parts = [];
    const gpa = i === 0 && bonus.gpaHigh;
    if (gpa) parts.push({ label: `성적초과(${B.gpa.minGpa.toFixed(1)} 이상)`, credits: B.gpa.credits });
    // 직전 학기가 9학기 이상(초과학기) 등록이면 이월 없음. profile.semesterNo = 지금 몇 번째 학기인지 (S-OVER)
    const prevSemNo = profile.semesterNo ? profile.semesterNo + i : null;
    const carryBlocked = B.carry.noneFromSemester && prevSemNo && prevSemNo >= B.carry.noneFromSemester;
    if (!carryBlocked && prevLoad !== null && prevLoad !== undefined && prevLoad >= rules.minCreditsPerSemester.value) {
      const carry = Math.min(B.carry.max, Math.max(0, base - prevLoad));
      if (carry) parts.push({ label: '이월', credits: carry });
    }
    const inv = B.innovation;
    if (!(gpa && inv.notWithGpa) && items.some((e) => !e.custom && cat[e.id] && inv.modules.includes(cat[e.id].module))) {
      parts.push({ label: '혁신융합', credits: inv.credits });
    }
    const field = i === 0 ? Number(bonus.fieldPractice) || 0 : 0;
    if (field) parts.push({ label: '산업체현장실습 차감', credits: -field });
    return { base, parts, cap: base + parts.reduce((s, p) => s + p.credits, 0) };
  }

  const PLACEHOLDER = {
    major: '전공 과목 (과목 미정)', base: '학과기초 과목 (과목 미정)', gen: '교양 과목 (과목 미정)', free: '아무 과목 (자유선택)',
  };

  // 부족한 요건을 채울 과목 고르기.
  // 1) 필수 과목  2) 트랙 모듈 학점 (두 트랙에 함께 인정되는 과목 우선)  3) 학과기초 → 전공 → 교양 → 졸업 학점
  // 같은 조건을 채우는 과목이 여럿일 때 고르는 순서. seed가 0이면 교과목표 순서(기본 추천), 아니면 seed로 섞어 다른 버전을 만든다.
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffled(list, rand) {
    if (!rand) return list;
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  // opts.seed: 0(기본) 또는 다른 버전 번호. 필수 과목과 채우는 학점은 같고, 같은 조건의 과목 중 무엇을 고르는지만 달라진다.
  function pickCourses(rules, profile, entries, opts = {}) {
    const rand = opts.seed ? seededRandom(opts.seed) : null;
    const picked = [];
    const all = () => [...entries, ...picked];
    const used = () => new Set(all().filter((e) => !e.custom && e.status !== 'failed').map((e) => e.id));
    const add = (id, reason) => picked.push({ id, status: 'planned', reason });
    const candidates = () => { const u = used(); return shuffled(rules.courses.filter((c) => !u.has(c.id) && !c.noAutoPlan), rand); };
    const trackMods = new Set((profile.tracks || []).flatMap((t) => (rules.tracks[t] ? rules.tracks[t].parts.flatMap((p) => p.modules) : [])));

    let ev = evaluate(rules, profile, all(), 'plan');
    const req = ev.requirements.find((r) => r.kind === 'allOf');
    if (req) for (const c of req.missing) if (!used().has(c)) add(c, req.name);
    if (ev.trackCommon) for (const c of ev.trackCommon.missing) if (!used().has(c)) add(c, '트랙 공통 필수');

    // 트랙 모듈: 미충족 파트를 가장 많이 채우는 과목부터
    for (let guard = 0; guard < 60; guard++) {
      ev = evaluate(rules, profile, all(), 'plan');
      const needs = ev.tracks.flatMap((t) => t.parts.filter((p) => !p.satisfied).map((p) => ({ label: `${t.name} ${p.label}`, modules: p.modules })));
      if (!needs.length) break;
      let top = null, topScore = 0;
      for (const c of candidates()) {
        const score = needs.filter((n) => n.modules.includes(c.module)).length;
        if (score > topScore) { top = c; topScore = score; }
      }
      if (!top) break; // 모듈에 남은 과목이 없음 — validatePlan이 경고
      add(top.id, needs.filter((n) => n.modules.includes(top.module)).map((n) => n.label).join(', '));
    }

    // 학점 요건: 우선순위대로 하나씩 채운다
    const order = ['area:base', 'majorElective', 'majorTotal', 'area:gen', 'total'];
    const keyOf = (r) => (r.kind === 'area' ? `area:${r.area}` : r.kind);
    let ph = 0;
    for (let guard = 0; guard < 80; guard++) {
      ev = evaluate(rules, profile, all(), 'plan');
      const conv = new Set(ev.converted);
      const isMajor = (c) => courseKind(rules, c) === 'major' || (courseKind(rules, c) === 'other' && conv.has(c.module));
      const reqSet = new Set(req ? req.courses : []);
      const unmet = ev.requirements.filter((r) => !r.satisfied && order.includes(keyOf(r)))
        .sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));
      if (!unmet.length) break;
      const r = unmet[0];
      const area = r.kind === 'area' ? r.area : r.kind === 'total' ? 'free' : 'major';
      const test = area === 'base' ? (c) => courseKind(rules, c) === 'base'
        : area === 'major' ? (c) => isMajor(c) && (r.kind === 'majorTotal' || !reqSet.has(c.id))
          : () => false; // 교양·자유선택은 교과목표 밖에서 고르므로 자리만 잡는다
      const pool = candidates().filter(test);
      const pick = pool.find((c) => trackMods.has(c.module) && courseKind(rules, c) === 'major') || pool.find((c) => courseKind(rules, c) !== 'other') || pool[0];
      if (pick) { add(pick.id, r.name); continue; }
      ph++;
      picked.push({ custom: true, id: `PH-${ph}`, status: 'planned', placeholder: true, credits: 3, area, name: PLACEHOLDER[area], reason: r.name });
    }
    return picked;
  }

  // 남은 학기 수강안 (추정). 실제 개설 과목은 매 학기 수강신청 기간에 확정되므로,
  // 표준 이수 학기(붙임2 p.6)를 참고해 학기당 한도 안에서 고르게 나눈다.
  // 추천안은 첫 학기 외에는 이월을 0으로 보고(뒤 학기 한도가 앞 학기 배치에 따라 바뀌지 않도록) 보수적으로 배치한다.
  function plan(rules, profile, entries, opts = {}) {
    const cat = catalog(rules);
    const labels = profile.remainingSemesters > 0 ? semesterLabels(profile.startTerm, profile.remainingSemesters) : [];
    const max = Number(profile.maxCredits) || rules.maxCreditsPerSemester.value;
    const firstPrev = currentLoad(rules, profile, entries);
    const capOf = (i, items) => semesterCap(rules, profile, i, items, i === 0 ? firstPrev : null).cap;
    const picked = pickCourses(rules, profile, entries, opts);
    const total = picked.reduce((s, p) => s + entryCredits(p, cat), 0);
    const softCap = Math.min(max, Math.max(3, Math.ceil(total / Math.max(1, labels.length) / 3) * 3));
    const semesters = labels.map((label) => ({ label, items: [] }));
    const load = (s) => s.items.reduce((a, e) => a + entryCredits(e, cat), 0);
    const unassigned = [];

    // 표준 학기가 있는 과목을 먼저 맞추고, 정보 없는 과목·미정 과목은 남은 자리에 넣는다.
    // 표준 학기에 자리가 없으면 다른 학기라도 넣는다(추정이므로).
    const constrained = (p) => (!p.custom && cat[p.id] && cat[p.id].offered.length ? 0 : 1);
    const ordered = picked.map((p, i) => [p, i]).sort((a, b) => constrained(a[0]) - constrained(b[0]) || a[1] - b[1]).map(([p]) => p);
    for (const p of ordered) {
      const c = !p.custom && cat[p.id];
      const cr = entryCredits(p, cat);
      let at = -1;
      for (const [soft, strict] of [[true, true], [false, true], [false, false]]) {
        for (let i = 0; i < semesters.length && at < 0; i++) {
          const cap = soft ? softCap : capOf(i, [...semesters[i].items, p]);
          if (load(semesters[i]) + cr > cap) continue;
          if (strict && c && c.offered.length && !c.offered.includes(termOf(semesters[i].label))) continue;
          at = i;
        }
        if (at >= 0) break;
      }
      if (at < 0) unassigned.push(p); else semesters[at].items.push(p);
    }
    const capacity = semesters.reduce((s, sem, i) => s + capOf(i, sem.items), 0);
    return { semesters, unassigned, picked, neededCredits: total, capacity, maxCredits: max, seed: opts.seed || 0 };
  }

  const pickKey = (pl) => pl.picked.filter((e) => !e.custom).map((e) => e.id).sort().join(',');

  // 추천 시간표 순위: 여러 조합(seed)을 만들어 효율 순으로 정렬한다.
  //   1) 총 학점이 가장 적은 것만(최소 학점)  2) 미배정 학점이 적은 것  3) 표준 개설 학기와 다른 학기에 넣은 과목이 적은 것
  //   4) 꼭 들어야 할 과목(필수)을 앞 학기에 둔 것  5) 학기별 학점이 고른 것
  // 고른 과목 조합이 같은 안은 하나만 남긴다.
  function planScore(rules, profile, pl) {
    const cat = catalog(rules);
    const cur = rules.curricula[profile.curriculum];
    const allOf = cur && cur.requirements.find((r) => r.kind === 'allOf');
    const must = new Set([...(allOf ? allOf.courses : []), ...((profile.tracks || []).length ? rules.trackCommonRequired.courses : [])]);
    const unassigned = pl.unassigned.reduce((a, e) => a + entryCredits(e, cat), 0);
    let offTerm = 0, mustLate = 0;
    const loads = pl.semesters.map((sem, i) => {
      for (const e of sem.items) {
        const c = !e.custom && cat[e.id];
        if (c && c.offered.length && !c.offered.includes(termOf(sem.label))) offTerm++;
        if (c && must.has(c.id)) mustLate += i;
      }
      return sem.items.reduce((a, e) => a + entryCredits(e, cat), 0);
    });
    const avg = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
    const spread = loads.reduce((a, l) => a + (l - avg) ** 2, 0);
    return [pl.neededCredits, unassigned, offTerm, mustLate, spread];
  }
  function rankedPlans(rules, profile, entries, tries = 24) {
    const seen = new Set(), list = [];
    for (let s = 0; s < tries; s++) {
      const pl = plan(rules, profile, entries, { seed: s });
      const k = pickKey(pl);
      if (seen.has(k)) continue;
      seen.add(k);
      list.push({ pl, score: planScore(rules, profile, pl) });
    }
    const minCr = Math.min(...list.map((x) => x.score[0]));
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    return list.filter((x) => x.score[0] === minCr).sort((a, b) => cmp(a.score, b.score)).map((x) => x.pl);
  }

  // 바꿔 들을 수 있는 과목: 계획의 선택 과목(필수 아님) 하나를 같은 학점·같은 영역의 다른 과목으로 바꿔도
  // 계획에서 채우던 졸업·트랙 기준이 하나도 깨지지 않으면 대체 과목으로 본다. 그 학기에 표준 개설되는 과목만(정보 없으면 포함).
  // 억지 대안을 만들지 않도록, 실제로 같은 조건을 채우는 과목이 있을 때만 결과에 넣는다.
  function alternatives(rules, profile, entries, planState) {
    const cat = catalog(rules);
    const base = entries.filter((e) => e.status !== 'planned');
    const placed = [
      ...planState.semesters.flatMap((s) => s.items.map((e) => ({ e, term: termOf(s.label) }))),
      ...planState.unassigned.map((e) => ({ e, term: null })),
    ];
    const withPlan = (items) => [...base, ...items.map((e) => ({ ...e, status: 'planned' }))];
    const sig = (ev) => [...ev.requirements.filter((r) => r.unit === '학점' || r.unit === '과목').map((r) => r.satisfied), ...ev.tracks.map((t) => t.satisfied)];
    const before = sig(evaluate(rules, profile, withPlan(placed.map((p) => p.e)), 'plan'));
    const used = new Set([...base, ...placed.map((p) => p.e)].filter((e) => !e.custom && e.status !== 'failed').map((e) => e.id));
    const cur = rules.curricula[profile.curriculum];
    const allOf = cur && cur.requirements.find((r) => r.kind === 'allOf');
    const must = new Set([...(allOf ? allOf.courses : []), ...((profile.tracks || []).length ? rules.trackCommonRequired.courses : [])]);
    const out = {};
    for (const { e, term } of placed) {
      if (e.custom || must.has(e.id) || !cat[e.id]) continue;
      const c = cat[e.id];
      const alts = rules.courses.filter((y) => !used.has(y.id) && !y.noAutoPlan && y.credits === c.credits && courseKind(rules, y) === courseKind(rules, c)
        && (term == null || !y.offered.length || y.offered.includes(term)))
        .filter((y) => {
          const after = sig(evaluate(rules, profile, withPlan(placed.map((p) => (p.e === e ? { id: y.id } : p.e))), 'plan'));
          return after.every((ok, i) => ok || !before[i]);
        })
        .map((y) => y.id);
      if (alts.length) out[e.id] = alts;
    }
    return out;
  }

  // 졸업까지 남은 기준 정리 (계획서 앞부분): 영역별 남은 학점, 트랙 기준별 남은 학점과 채울 수 있는 과목, 꼭 들어야 할 과목
  function remainingNeeds(rules, profile, entries) {
    const cat = catalog(rules);
    const ev = evaluate(rules, profile, entries, 'predict');
    const have = new Set(ev.items.map((i) => i.cid).filter(Boolean));
    const credits = ev.requirements.filter((r) => r.unit === '학점' && r.kind !== 'majorElective')
      .map((r) => ({ id: r.id, name: r.name, needed: r.needed, earned: r.earned, left: Math.max(0, r.needed - r.earned) }));
    const tracks = ev.tracks.map((t) => ({
      id: t.id, name: t.name, satisfied: t.satisfied,
      parts: t.parts.map((p) => ({
        label: p.label, min: p.min, earned: p.earned, left: Math.max(0, p.min - p.earned), satisfied: p.satisfied,
        options: p.satisfied ? [] : rules.courses.filter((c) => p.modules.includes(c.module) && !have.has(c.id) && !c.noAutoPlan).map((c) => c.id),
      })),
      commonMissing: t.commonMissing,
    }));
    const must = [];
    const req = ev.requirements.find((r) => r.kind === 'allOf');
    if (req) for (const id of req.missing) must.push({ id, reason: req.name });
    if (ev.trackCommon) for (const id of ev.trackCommon.missing) if (!must.some((m) => m.id === id)) must.push({ id, reason: '트랙 공통 필수' });
    return { credits, tracks, must: must.map((m) => ({ ...m, name: cat[m.id].name, credits: cat[m.id].credits, offered: cat[m.id].offered })), evaluation: ev };
  }

  // 계획 검사: 졸업요건·트랙 미충족, 학기당 학점 초과, 표준 학기와 다른 배치(참고)
  function validatePlan(rules, profile, entries, planState) {
    const cat = catalog(rules);
    const warnings = [];
    const placed = [];
    const caps = [];
    let prev = currentLoad(rules, profile, entries);
    for (const [i, s] of planState.semesters.entries()) {
      const load = s.items.reduce((a, e) => a + entryCredits(e, cat), 0);
      const c = semesterCap(rules, profile, i, s.items, prev);
      caps.push(c);
      prev = load;
      if (load > c.cap) warnings.push({ level: 'error', text: `${s.label}: ${load}학점으로 학기당 한도 ${c.cap}학점을 넘습니다.` });
      const isLast = i === planState.semesters.length - 1;
      const minCr = isLast ? rules.minCreditsPerSemester.last : rules.minCreditsPerSemester.value;
      if (load > 0 && load < minCr) warnings.push({ level: 'warn', text: `${s.label}: ${load}학점입니다. 매 학기 최저 ${minCr}학점${isLast ? '(최종학기)' : ''} 이상 신청해야 합니다.` });
      for (const e of s.items) {
        placed.push({ ...e, status: 'planned' });
        const c = !e.custom && cat[e.id];
        if (c && c.offered.length && !c.offered.includes(termOf(s.label))) {
          warnings.push({ level: 'info', key: e.id, text: `${c.name}: 표준 이수 학기는 ${c.offered.join('·')}학기입니다. 실제 개설 여부는 수강신청 기간에 확인하세요.` });
        }
      }
    }
    if (planState.unassigned.length) {
      const cr = planState.unassigned.reduce((a, e) => a + entryCredits(e, cat), 0);
      warnings.push({ level: 'error', text: planState.semesters.length
        ? `남은 학기 안에 넣지 못한 과목이 ${cr}학점 있습니다. 학기를 늘리거나 학기당 학점을 조정해야 합니다.`
        : `남은 정규 학기가 없는데 더 들어야 할 과목이 ${cr}학점 있습니다. 추가 학기가 필요합니다.` });
    }
    const ev = evaluate(rules, profile, [...entries.filter((e) => e.status !== 'planned'), ...placed], 'plan');
    for (const t of ev.tracks) {
      if (t.satisfied) continue;
      const parts = t.parts.filter((p) => !p.satisfied).map((p) => `${p.label} ${p.earned}/${p.min}`);
      if (t.commonMissing.length) parts.push(`모듈 내 필수 ${t.commonMissing.map((c) => cat[c].name).join(', ')}`);
      warnings.push({ level: 'error', text: `트랙 미이수 — ${t.name} (${parts.join(', ')})` + (t.convertsToMajor.length ? ' → 타과 과목이 전공으로 인정되지 않습니다' : '') });
    }
    for (const r of ev.requirements) {
      // 전공선택(필수 외 전공)은 전공필수 + 전공 최저학점을 채우면 따라 채워지므로 따로 경고하지 않는다
      if (r.satisfied || !['학점', '과목'].includes(r.unit) || r.kind === 'majorElective') continue;
      const detail = r.kind === 'allOf' ? r.missing.map((c) => cat[c].name).join(', ') : `${r.earned}/${r.needed}학점`;
      warnings.push({ level: 'error', text: `졸업요건 미충족 — ${r.name} (${detail})` });
    }
    return { warnings, caps, evaluation: ev, ok: !warnings.some((w) => w.level === 'error') };
  }

  // 성적표(영역별 이수 교과목 현황) 붙여넣기 파싱.
  // "2025-2 _식품유통경제학[553110] 3 P" → 이수, 성적이 없으면 수강 중.
  // 전적대 인정 줄(99000000xx)은 영역별 인정 학점으로 따로 돌려준다.
  // 과목 위에 있는 영역 제목(공교필수·학과기초·전공선택·자유선택 등)으로 학과 교과목이 아닌 과목의 영역을 정한다.
  const SECTION_AREAS = [
    [/공교필수|공통교양|교양필수|필수교양|영역별교양|영역교양|선택교양|이수교양/, 'gen'],
    [/학과기초|학문기초|학부\(과\)기초/, 'base'],
    [/전공필수|전공선택/, 'major'],
    [/자유선택/, 'free'],
  ];
  // PDF에서 뽑은 글자는 띄어쓰기가 사라지거나(칸이 붙음) 하이픈·괄호가 다른 기호로 나올 수 있다.
  // 그래서 공백을 모두 지운 뒤 「학년도-학기 과목명[학수번호] 학점 성적」을 읽는다.
  // 학점 뒤에는 성적, 다음 과목의 학년도, 또는 글자(영역 제목)가 온다 — 그 경계로 학점(1~2자리)을 자른다.
  const compactText = (s) => String(s).replace(/[‐‑‒–—―−－]/g, '-').replace(/［/g, '[').replace(/］/g, ']').replace(/[\s\u0000-\u001f]+/g, '');
  function parseTranscript(rules, rawText) {
    const found = [], unmatched = [], transfer = {};
    const text = compactText(rawText);
    const re = /(20\d{2})-([0-3])([^[\]]+?)\[(\d{5,10})\](\d{1,2}?)((?:NP|P|[A-F][+0]?)?)(?=20\d{2}-[0-3]|[^0-9A-F+]|$)/g;
    const courses = [];
    let m;
    while ((m = re.exec(text))) courses.push({ m, start: m.index, end: m.index + m[0].length });
    const headRe = new RegExp(SECTION_AREAS.map(([r]) => r.source).join('|'), 'g');
    const heads = [];
    while ((m = headRe.exec(text))) {
      const at = m.index;
      if (courses.some((c) => at >= c.start && at < c.end)) continue; // 과목명 속 단어(전적대학인정학점공통교양 등)는 제목이 아님
      heads.push({ at, area: SECTION_AREAS.find(([r]) => r.test(m[0]))[1] });
    }
    const areaAt = (pos) => { let a = 'free'; for (const hd of heads) if (hd.at < pos) a = hd.area; return a; };
    for (const { m: mm, start } of courses) {
      m = mm;
      const [, year, term, name, code, credits, grade] = m;
      if (code.startsWith('99000000') || term === '0') {
        const area = /공통교양/.test(name) ? 'gen' : /계열교양|기초/.test(name) ? 'base' : /자유/.test(name) ? 'free' : /전공/.test(name) ? 'major' : null;
        if (area && credits) transfer[area] = (transfer[area] || 0) + Number(credits);
        continue;
      }
      // F·NP는 학점 인정이 안 된다 → 'failed' (판정에서 빠지고, 재수강·다른 과목으로 채워야 한다고 안내)
      const status = !grade ? 'inprogress' : /^(F|NP)$/.test(grade) ? 'failed' : 'done';
      const c = findCourse(rules, { name, code });
      const when = `${year}-${term}`;
      if (c) found.push({ id: c.id, status, raw: name, term: when, ...(status === 'failed' ? { grade } : {}) });
      else unmatched.push({ name: norm(name), code, credits: Number(credits) || 0, status, area: areaAt(start), term: when, ...(status === 'failed' ? { grade } : {}) });
    }
    return { found, unmatched, transfer };
  }

  // 기준 학기: 그 학기를 포함해 이전에 들은 과목만 남긴다. 같은 과목을 여러 번 들었으면(재수강) 기준 학기까지의 마지막 기록을 쓴다.
  // 기준 학기 과목은 그 시점에 「수강 중」(asOfDone이면 「이수」). asOf가 없으면 전체(현재) 기준.
  const termNum = (t) => { const x = /^(20\d{2})-([0-3])$/.exec(t || ''); return x ? Number(x[1]) * 10 + Number(x[2]) : null; };
  function coursesAsOf(entries, asOf, opts = {}) {
    const cut = termNum(asOf);
    const best = new Map();
    const order = [];
    for (const e of entries) {
      const n = termNum(e.term);
      if (cut != null && n != null && n > cut) continue;
      const key = e.custom ? 'X-' + (e.code || e.id) : e.id;
      const prev = best.get(key);
      if (!prev) order.push(key);
      if (!prev || (n == null ? -1 : n) > (termNum(prev.term) == null ? -1 : termNum(prev.term))) best.set(key, e);
    }
    return order.map((k) => {
      const e = best.get(k);
      const status = cut != null && termNum(e.term) === cut ? (opts.asOfDone ? 'done' : 'inprogress') : e.status;
      return { ...e, status };
    });
  }
  // 학기 라벨 a가 b보다 몇 학기 뒤인지 (정규학기 1·2만)
  function termDiff(a, b) {
    const x = /^(20\d{2})-([12])$/.exec(a), y = /^(20\d{2})-([12])$/.exec(b);
    return x && y ? (Number(x[1]) * 2 + Number(x[2])) - (Number(y[1]) * 2 + Number(y[2])) : null;
  }

  // 학점이수 자가진단 시뮬레이션(포털 내보내기 PDF 본문) 읽기.
  // 머리글(기준년도·학년학기·입학구분·사회봉사·공인외국어), 영역별 표, 뒤에 붙은 「영역별 이수 교과목 현황」을 함께 읽는다.
  // 이름·학번은 읽지 않는다.
  const SIM_AREAS = {
    '교양과정_공통': { label: '공통교양' }, '교양과정_영역': { label: '영역교양' }, '교양과정_일반': { label: '일반교양' },
    '교양과정_최저학점': { label: '교양 최저학점', req: 'GEN' }, '학과(부)기초': { label: '학과(부)기초', req: 'BASE' }, '학문기초': { label: '학문기초', req: 'BASE' },
    '심화전공_전공필수': { label: '전공필수', req: 'REQ' }, '심화전공_전공선택': { label: '전공선택', req: 'ELEC' }, '심화전공_최저학점': { label: '전공 최저학점', req: 'MAJOR' },
    '교직': { label: '교직' }, '자유': { label: '자유' }, '졸업최저학점': { label: '졸업 최저학점', req: 'TOTAL' },
  };
  function curriculumForYear(rules, y) {
    return Object.keys(rules.curricula).find((k) => { const c = rules.curricula[k]; return (c.fromYear == null || y >= c.fromYear) && (c.toYear == null || y <= c.toYear); }) || null;
  }
  // 적용 학번(교육과정 연도): 일반 재학생은 입학년도, 편입생은 편입년도에서 편입 학년만큼 거슬러 올라간다 (2025년 3학년 편입 → 2023)
  function cohortYear(profile) {
    const y = Number(profile.entryYear);
    if (!y) return null;
    return profile.studentType === 'transfer' ? y - ((Number(profile.transferGrade) || 3) - 1) : y;
  }
  function curriculumForProfile(rules, profile) {
    const y = cohortYear(profile);
    return y ? curriculumForYear(rules, y) : null;
  }
  function parseSimulation(rules, text) {
    const doc = normDoc(text);
    if (!doc.includes('자가진단시뮬레이션')) return null;
    const pick = (re) => { const x = re.exec(doc); return x ? x.slice(1) : null; };
    const by = pick(/자가진단시뮬레이션-(20\d{2})/);
    const baseYear = by ? Number(by[0]) : null;
    const entry = pick(/(편입학|신입학)\((20\d{2})\)/);
    const yt = pick(/학년-학기([1-6])-([12])/);
    const svc = pick(/사회봉사P\/F(NP|P|F|N)/);
    const lang = pick(/공인외국어P\/F(NP|P|F|N)/);
    const thesis = pick(/통과여부1전공(P|N)/);
    const flat = String(text).replace(/[\s\u0000-\u001f]+/g, ' ').replace(/»/g, '≫');
    const rows = [];
    const rowRe = /주\s?전\s?공\s+(?!≫)([^\s\d≫][^\s≫]*)\s+((?:\d+\s+)*\d+)(?:\s+(P|N)(?=\s|$))?(?:\s+(\d+)(?=\s|$))?/g;
    let m;
    while ((m = rowRe.exec(flat))) {
      const def = SIM_AREAS[m[1]];
      if (!def) continue;
      const n = m[2].trim().split(/\s+/).map(Number);
      if (n.length < 6) continue;
      const rest = n.slice(6), flag = m[3] || null;
      rows.push({
        name: m[1], label: def.label, req: def.req || null, at: m.index,
        std: n[0], earned: n[2], enrolled: n[4], pass: flag,
        lack: flag === 'N' && rest.length ? rest[0] : null,
        retake: m[4] ? Number(m[4]) : (!flag && rest.length === 1 ? rest[0] : null),
        subs: [],
      });
    }
    // 「≫」 세부 줄(교양 세부 과목·영역: 대학영어1, 영역별교양 등)은 바로 위 영역 줄에 붙인다
    const subRe = /주\s?전\s?공\s+≫\s+(\S(?:.*?\S)?)\s+((?:\d+\s+){3,}\d+)(?:\s+(P|N)(?=\s|$))?/g;
    while ((m = subRe.exec(flat))) {
      const parent = rows.filter((r) => r.at < m.index).pop();
      if (!parent) continue;
      const n = m[2].trim().split(/\s+/).map(Number);
      parent.subs.push({ name: m[1], std: n[0], earned: n[2] || 0, enrolled: n[4] || 0, pass: m[3] || null });
    }
    rows.forEach((r) => { delete r.at; });
    return {
      baseYear, curriculum: baseYear ? curriculumForYear(rules, baseYear) : null,
      studentType: entry ? (entry[0] === '편입학' ? 'transfer' : 'regular') : null, entryYear: entry ? Number(entry[1]) : null,
      year: yt ? Number(yt[0]) : null, term: yt ? Number(yt[1]) : null,
      service: svc ? svc[0] : null, lang: lang ? lang[0] : null, thesis: thesis ? thesis[0] : null,
      rows, transcript: parseTranscript(rules, text),
    };
  }

  // 포털 「현재」 학점(취득)과 도구 판정(now 모드)을 영역별로 대조
  // 교양 세부 남은 것 (포털 자가진단의 교양과정_공통·영역·일반 줄 기준). 기준 0인 영역(편입생 일괄 인정 등)은 뺀다.
  // have = 취득 + 이번 학기 수강신청. subs: 대학영어1처럼 기준이 있는 세부 항목 중 아직 못 채운 것.
  function genDetail(rows) {
    return (rows || []).filter((r) => /^교양과정_(공통|영역|일반)$/.test(r.name) && r.std > 0).map((r) => {
      const have = (r.earned || 0) + (r.enrolled || 0);
      const subsLeft = (r.subs || []).filter((x) => x.std > 0 && (x.earned || 0) + (x.enrolled || 0) < x.std).map((x) => x.name);
      return { label: r.label, std: r.std, have, left: Math.max(0, r.std - have), subsLeft };
    });
  }
  function comparePortal(rules, profile, entries, rows) {
    const ev = evaluate(rules, profile, entries, 'now');
    return rows.filter((r) => r.req).map((r) => {
      const t = ev.requirements.find((q) => q.id === r.req);
      // 필수과목 요건은 과목 단위라 학점 합으로 바꿔 비교한다
      const toolEarned = t ? (t.unit === '과목' ? sum(t.counted) : t.earned) : null;
      const toolNeeded = t ? (t.unit === '과목' ? t.courses.reduce((s, id) => s + (catalog(rules)[id] || { credits: 0 }).credits, 0) : t.needed) : null;
      return { ...r, toolEarned, toolNeeded, same: toolEarned === r.earned && toolNeeded === r.std };
    });
  }

  // 첨부한 학사종합안내 본문(텍스트)을 기준 데이터와 대조한다.
  // 공백을 모두 지우고 전각 기호를 반각으로 바꾼 뒤, 학년도와 기준 문구(rules.handbook.checks)가 있는지 본다.
  const normDoc = (s) => String(s).replace(/[\s\u0000-\u001f]+/g, '').replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')').replace(/[‐‑‒–—―−－]/g, '-');
  const runChecks = (defs, doc) => defs.map((c) => {
    const missing = c.all.filter((p) => !doc.includes(normDoc(p)));
    return { id: c.id, label: c.label, sourceId: c.sourceId, ok: missing.length === 0, missing };
  });
  function checkHandbook(rules, text) {
    const doc = normDoc(text);
    const m = /(20\d{2})학년도학사종합안내/.exec(doc);
    const year = m ? Number(m[1]) : null;
    const checks = runChecks(rules.handbook.checks, doc);
    const yearOk = year === rules.handbook.year;
    return { year, yearOk, checks, ok: yearOk && checks.every((c) => c.ok) };
  }
  function checkTrackDoc(rules, text) {
    const checks = runChecks(rules.trackDoc.checks, normDoc(text));
    return { checks, ok: checks.every((c) => c.ok) };
  }

  // 첨부한 PDF가 어떤 문서인지: 시뮬레이션 출력 / 학사종합안내 / 학과 트랙 교육과정
  function classifyDoc(text) {
    const doc = normDoc(text);
    if (/자가진단시뮬레이션-20\d{2}/.test(doc)) return 'simulation';
    if (/20\d{2}학년도학사종합안내/.test(doc)) return 'handbook';
    if (doc.includes('학과교과목모듈화') || doc.includes('트랙교육과정구성')) return 'track';
    return null;
  }

  const api = { MODES, AREAS, catalog, findCourse, resolveEntry, itemsFor, transferItems, evaluate, serviceHours, checkHandbook, checkTrackDoc, classifyDoc, parseSimulation, coursesAsOf, termDiff, comparePortal, genDetail, langPaths, curriculumForYear, cohortYear, curriculumForProfile, semesterLabels, currentLoad, semesterCap, pickCourses, plan, pickKey, planScore, rankedPlans, alternatives, remainingNeeds, validatePlan, entryKey, entryCredits, parseTranscript, examPaths };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(this);
