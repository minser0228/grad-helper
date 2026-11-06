// 화면 렌더링과 상태 관리. 판정·계획 계산은 engine.js, 기준 데이터는 rules.js.
(function () {
  const R = window.RULES;
  const E = window.Engine;
  const CAT = E.catalog(R);
  const STORE_KEY = 'gradcheck.v3';

  const defaults = () => ({
    profile: {
      studentType: null,
      curriculum: null, // 입학년도(편입생은 편입년도·편입 학년)로 자동 결정 (Engine.curriculumForProfile)
      entryYear: null,
      transferGrade: 3,
      year: null,
      term: null,
      extraSemesters: 0,
      maxCredits: R.maxCreditsPerSemester.value,
      bonus: { gpaHigh: false, currentLoad: '' },
      transferCredits: { gen: 0, base: 0, free: 0, major: 0 },
      asOf: null, // (화면에서 뺌) 기준 학기 — 늘 null = 현재
      asOfDone: false,
      trackChoice: null,
      tracks: [],
      extra: { toeic: '', lang: 'N', langTest: 'toeic', langScore: '', langRoutes: [], examPassed: false, contest: false, journal: false, points: 0, service: 'N', serviceLectures: 0, serviceFieldHours: 0, serviceCampusHours: 0, serviceBlood: 0 },
    },
    mode: null, // 처음 고른 목적: 'plan'(수강 계획 세우기) / 'grad'(졸업 요건 확인). 마지막 탭과 보이는 입력만 다르다
    taken: [],
    plan: null,
    view: 'predict',
    handbook: null, // { year, fileName, checkedAt, checks:[{id,ok}] } — 첨부한 학사종합안내 확인 결과
    portal: null, // { fileName, checkedAt, baseYear, rows, summary } — 불러온 자가진단 시뮬레이션 (이름·학번 없음)
    trackDoc: null, // { fileName, checkedAt, checks } — 첨부한 트랙 교육과정(붙임2) 확인 결과
    planShown: false, // 「추천 시간표 만들기」를 눌렀는지
    simCourses: [], // 시뮬레이션에서 읽은 과목 전체(들은 학기 포함, 재수강 기록도). 기준 학기에 따라 taken을 다시 만든다
  });

  // 성적 정보는 이 탭(sessionStorage)에만 보관한다 — 창·탭을 닫으면 지워진다(공용 PC 대비). 새로고침해도 남는다.
  // 계속 쓰려면 「백업 파일 저장」. 예전 버전이 localStorage에 남긴 기록은 지운다.
  const STORE = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  function load() {
    try {
      const raw = STORE && STORE.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw), d = defaults();
        // 학기당 최대 학점은 고정값 — 예전에 직접 바꿔 저장한 값은 버린다
        return { ...d, ...s, profile: { ...d.profile, ...s.profile, maxCredits: d.profile.maxCredits, extra: { ...d.profile.extra, ...(s.profile || {}).extra } } };
      }
    } catch (e) { /* 저장소 사용 불가 */ }
    return defaults();
  }
  function save() {
    try { if (STORE) STORE.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
  }

  let state = load();
  const openCards = new Set();
  const openSources = new Set();

  // ───────── 공통 헬퍼 ─────────
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const $ = (id) => document.getElementById(id);
  const badge = (cls, text) => h('span', { class: 'badge ' + cls }, text);
  const checkBadge = (show = true) => (show ? badge('check', '확인 필요') : null);
  const courseName = (id) => (CAT[id] ? CAT[id].name : id);
  // 24학번~ 「모듈 내 필수」는 트랙과 관계없이 졸업 필수다. 트랙을 안 하는 학생에게는 「필수 과목」으로 보여 준다.
  const reqLabel = (name) => (name === '모듈 내 필수' && state.profile.trackChoice !== 'yes' ? '필수 과목' : name);
  const STATUS_LABEL = { done: '이수', inprogress: '수강 중', planned: '계획', failed: 'F·NP (학점 미인정)' };
  const toggleSet = (set, key, rerender) => { set.has(key) ? set.delete(key) : set.add(key); rerender(); };

  function sourceView(sourceId, extra) {
    const s = R.sources[sourceId];
    if (!s) return null;
    return h('div', { class: 'source' },
      h('div', {}, h('b', {}, s.title), s.verified ? badge('ok', '확인됨') : checkBadge()),
      h('div', { class: 'ref' }, s.ref),
      extra ? h('div', { class: 'ref' }, extra) : null);
  }
  // 「근거 보기」 링크는 화면에서 뺐다 (2026-11-06). 출처는 졸업 현황 맨 아래 「판정 기준 출처」에 모은다.
  const SHOW_SOURCE_LINKS = false;
  function sourceToggle(key, sourceId, rerender, extra) {
    if (!SHOW_SOURCE_LINKS) return [];
    return [
      h('button', { class: 'link', onclick: () => toggleSet(openSources, key, rerender) }, openSources.has(key) ? '근거 닫기' : '근거 보기'),
      openSources.has(key) ? sourceView(sourceId, extra) : null,
    ];
  }

  // 지금 달력상 학기와 다음 학기
  function calendarTerm(d = new Date()) {
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (m <= 2) return [y - 1, 2];
    return m <= 8 ? [y, 1] : [y, 2];
  }
  const termAfter = (t) => { const [y, n] = t.split('-').map(Number); return n === 1 ? `${y}-2` : `${y + 1}-1`; };
  const planStart = () => (state.profile.asOf ? termAfter(state.profile.asOf) : nextTermLabel());
  function nextTermLabel() {
    const [y, t] = calendarTerm();
    return t === 1 ? `${y}-2` : `${y + 1}-1`;
  }

  // 시작 조건: 도구 기준과 같은 학년도의 학사종합안내를 첨부해 확인했을 것
  // 시작 조건: 같은 학년도 학사종합안내 + 자가진단 시뮬레이션(또는 직접 입력 선택). 트랙 이수자는 트랙 교육과정 자료도.
  // 시작 조건: 자가진단 시뮬레이션(또는 직접 입력). 학사종합안내·붙임2는 관리자가 매년 기준을 대조할 때만 넣는다.
  const baseReady = () => !!state.portal;
  const MODES = { plan: { name: '수강 계획 세우기', result: 'plan' }, grad: { name: '졸업 요건 확인', result: 'status' } };
  const tabInMode = (tab) => !!state.mode && (tab !== 'status' && tab !== 'plan' || MODES[state.mode].result === tab);
  // 결과 화면은 「과목·트랙」에서 트랙 이수 여부(트랙 이수면 트랙까지)를 고른 뒤에 열린다
  const trackChosen = () => state.profile.trackChoice === 'no' || (state.profile.trackChoice === 'yes' && state.profile.tracks.length > 0);
  const tabAllowed = (tab) => tab === 'home' || (tab === 'purpose' ? baseReady() : tabInMode(tab) && baseReady() && (!['status', 'plan'].includes(tab) || trackChosen()));
  const ready = () => baseReady() && state.profile.studentType && state.profile.entryYear && R.curricula[state.profile.curriculum] && state.profile.year;
  // 지금 몇 번째 학기인지 (1학년 1학기 = 1, 4학년 2학기 = 8, 5학년 1학기 = 9 — 초과학기)
  const semesterNo = () => (state.profile.year ? (state.profile.year - 1) * 2 + state.profile.term : null);
  const regularLeft = () => (state.profile.year ? Math.max(0, 8 - semesterNo()) : 0);

  // 엔진에 넘길 프로필
  function engineProfile() {
    const p = state.profile;
    return {
      ...p,
      tracks: p.trackChoice === 'yes' ? p.tracks : [],
      remainingSemesters: Math.max(0, regularLeft() + (Number(p.extraSemesters) || 0)),
      semesterNo: semesterNo(),
      startTerm: planStart(),
      extra: { ...p.extra, toeic: Number(p.extra.toeic) || 0 },
    };
  }

  function update(patch) {
    const before = JSON.stringify(state.profile);
    state.profile = { ...state.profile, ...patch };
    if (['studentType', 'entryYear', 'transferGrade'].some((k) => k in patch) && state.profile.entryYear) {
      state.profile.curriculum = E.curriculumForProfile(R, state.profile);
    }
    if (before !== JSON.stringify(state.profile)) state.plan = null;
    save();
    render();
  }
  const updateExtra = (patch) => { state.profile = { ...state.profile, extra: { ...state.profile.extra, ...patch } }; save(); render(); };

  // 설명은 ? 를 눌렀을 때만 보인다
  const tip = (text, right) => h('details', { class: 'tip' + (right ? ' tip-right' : '') }, h('summary', { 'aria-label': '설명 보기' }, '?'), h('div', { class: 'tip-body' }, text));

  // hint: ? 로 접는 설명, note: 늘 보이는 짧은 결과, required: 꼭 입력해야 하는 칸 (빨간 *)
  function field(label, control, opts = {}) {
    return h('div', { class: 'field' },
      h('div', { class: 'field-row' },
        h('div', { class: 'field-label' }, h('label', { for: opts.id }, label, opts.required ? h('span', { class: 'req-mark', 'aria-label': '필수' }, ' *') : null), opts.hint ? tip(opts.hint) : null),
        h('div', { class: 'control' }, control),
        opts.sourceId ? sourceToggle(opts.key || label, opts.sourceId, render, opts.extra)[0] : null),
      opts.note ? h('div', { class: 'hint' }, opts.note) : null,
      opts.sourceId && openSources.has(opts.key || label) ? sourceView(opts.sourceId, opts.extra) : null);
  }
  const radios = (name, value, options, onchange) => h('div', { class: 'radios' }, options.map(([v, label, desc]) =>
    h('label', { class: 'radio' + (v === value ? ' on' : '') },
      h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onchange(v) }),
      h('span', {}, h('b', {}, label), desc ? h('span', { class: 'meta' }, ' ' + desc) : null))));

  // ───────── 0. 기준 문서 ─────────
  // pdf.js는 문서를 첨부할 때만 불러온다.
  // pdf.js는 프로젝트 안(vendor/)에 둔다 — 학교망·오프라인에서도 PDF를 읽을 수 있게 (Apache-2.0, vendor/pdfjs-3.11.174/LICENSE)
  const PDFJS = new URL('vendor/pdfjs-3.11.174/', location.href).href;
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise && window.pdfjsLib) pdfjsPromise = Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
        s.onerror = () => { pdfjsPromise = null; reject(new Error('PDF 읽기 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.')); };
        document.head.append(s);
      });
    }
    return pdfjsPromise;
  }
  async function pdfText(file, onPage) {
    const lib = await loadPdfjs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer(), cMapUrl: PDFJS + 'cmaps/', cMapPacked: true }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => it.str).join(' '));
      onPage(i, pdf.numPages);
    }
    return pages.join('\n');
  }

  let docBusy = null;
  let docErrors = [];
  const docIcon = (st) => ({ ok: '✓', warn: '⚠', error: '✗', none: '○', skip: '–' })[st];
  function docItem(title, need, st, lines, extra) {
    return h('div', { class: 'guide-block doc-item doc-' + st },
      h('h4', {}, `${docIcon(st)} ${title} `, badge(st === 'ok' ? 'brand' : st === 'skip' ? 'muted' : st === 'none' ? 'bad' : 'check', need)),
      ...lines.filter(Boolean).map((l) => (typeof l === 'string' ? h('div', { class: 'hint' }, l) : l)), extra || null);
  }
  const failedList = (defs, checks) => {
    const labels = new Map(defs.map((c) => [c.id, c.label]));
    const failed = checks.filter((c) => !c.ok);
    return failed.length ? h('ul', { class: 'course-marks' }, failed.map((c) => h('li', { class: 'mark-none' }, `✗ ${labels.get(c.id) || c.id}`, h('span', { class: 'meta' }, ` — 문서에서 찾지 못한 문구: ${c.missing.join(', ')}`)))) : null;
  };
  const when = (x) => `${x.fileName} · ${new Date(x.checkedAt).toLocaleDateString('ko-KR')}`;

  // 처음 화면: 자가진단 시뮬레이션 상태(필수), 목적 카드(PDF 넣은 뒤 활성), 관리자용 기준 문서 대조(접힘)
  function renderDoc() {
    const pt = state.portal;
    const sim = [];
    if (pt && pt.summary) {
      const sm = pt.summary;
      sim.push(docItem('학점이수 자가진단 시뮬레이션', '불러옴', 'ok', [
        [sm.curriculum && R.curricula[sm.curriculum] ? R.curricula[sm.curriculum].label : null, sm.studentType === 'transfer' ? '편입생' : sm.studentType ? '일반 재학생' : null,
          sm.year ? `${sm.year}학년 ${sm.term}학기` : null, sm.transferTotal ? `전적대 인정 ${sm.transferTotal}학점` : null, `과목 ${sm.courses}개`].filter(Boolean).join(' · ') + '를 불러왔습니다.',
        when(pt)]));
    }
    $('doc-list').replaceChildren(...[
      docBusy ? h('div', { class: 'warning info' }, docBusy) : null,
      ...docErrors.map((e) => h('div', { class: 'warning error' }, e)),
      ...sim,
    ].filter(Boolean));
    // 이미 넣었으면 다음 단계로 가는 버튼
    if (pt && !docBusy) $('doc-list').append(h('div', { class: 'home-next' }, h('button', { class: 'primary', onclick: () => showTab('purpose') }, '다음 → 목적 고르기')));

    // 관리자용: 새 학년도 학사종합안내·붙임2를 넣어 도구 기준과 대조. 다를 때만 펼쳐서 보인다.
    const hb = state.handbook, td = state.trackDoc;
    const admin = [];
    if (hb) {
      const bad = hb.year !== R.handbook.year ? -1 : hb.checks.filter((c) => !c.ok).length;
      admin.push(docItem(R.handbook.title, '대조', bad ? 'warn' : 'ok', [
        bad === -1 ? (hb.year ? `넣은 문서는 ${hb.year}학년도입니다. 기준 데이터(rules.js)를 ${hb.year}학년도로 갱신해야 합니다.` : '학년도를 찾지 못했습니다.')
          : bad ? `기준 ${hb.checks.length}개 중 ${bad}개를 문서에서 찾지 못했습니다. 개정되었을 수 있습니다.` : '도구 기준과 일치합니다.', when(hb)],
      bad > 0 ? failedList(R.handbook.checks, hb.checks) : null));
    }
    if (td) {
      const bad = td.checks.filter((c) => !c.ok).length;
      admin.push(docItem(R.trackDoc.title, '대조', bad ? 'warn' : 'ok', [bad ? `트랙 기준 ${td.checks.length}개 중 ${bad}개를 문서에서 찾지 못했습니다.` : '도구 기준과 일치합니다.', when(td)],
        bad ? failedList(R.trackDoc.checks, td.checks) : null));
    }
    if (!isAdmin()) { $('admin-docs').replaceChildren(); return; }
    $('admin-docs').replaceChildren(h('details', { class: 'admin-docs', open: true },
      h('summary', {}, '기준 문서 대조 (관리자용)'),
      h('p', { class: 'hint' }, `도구에는 ${R.handbook.title}와 학과 트랙 교육과정(붙임2) 기준이 이미 들어 있습니다. 학생은 넣지 않아도 됩니다. 새 학년도 문서가 나오면 위 칸에 넣어 기준이 바뀌었는지 확인하세요.`),
      admin.length ? admin : h('p', { class: 'hint' }, '아직 대조한 문서가 없습니다.')));
  }

  // 관리자(매년 기준 갱신): 주소 끝에 #admin 을 붙이면 처음 화면 아래에 「기준 문서 대조」가 보인다
  const isAdmin = () => /admin/.test(location.hash);
  window.addEventListener('hashchange', () => { if (currentTab === 'home') renderDoc(); });

  // 목적 고르기 화면
  function renderPurpose() {
    const sm = state.portal && state.portal.summary;
    $('purpose-sim').textContent = sm ? `불러온 정보: ${[sm.curriculum && R.curricula[sm.curriculum] ? R.curricula[sm.curriculum].label : null, sm.studentType === 'transfer' ? '편입생' : '일반 재학생', sm.year ? `${sm.year}학년 ${sm.term}학기` : null].filter(Boolean).join(' · ')}` : '';
    document.querySelectorAll('[data-mode-pick]').forEach((b) => b.classList.toggle('on', b.dataset.modePick === state.mode));
  }

  async function handleDocFiles(files) {
    docErrors = [];
    let simLoaded = false;
    for (const file of files) {
      docBusy = `${file.name} 읽는 중…`;
      renderDoc();
      try {
        const text = await pdfText(file, (i, n) => { docBusy = `${file.name} 읽는 중… ${i} / ${n}쪽`; renderDoc(); });
        const kind = E.classifyDoc(text);
        const stamp = { fileName: file.name, checkedAt: Date.now() };
        if ((kind === 'handbook' || kind === 'track') && !isAdmin()) {
          docErrors.push(`${file.name}: 자가진단 시뮬레이션 PDF가 아닙니다. 포털 졸업관리 → 자가진단 시뮬레이션에서 저장한 PDF를 넣어 주세요.`);
        } else if (kind === 'handbook') {
          const r = E.checkHandbook(R, text);
          state.handbook = { ...stamp, year: r.year, checks: r.checks.map((c) => ({ id: c.id, ok: c.ok, missing: c.missing })) };
        } else if (kind === 'simulation') {
          const sim = E.parseSimulation(R, text);
          if (!sim.transcript.found.length && !sim.transcript.unmatched.length) {
            docErrors.push(`${file.name}: 과목을 읽지 못했습니다. 포털 자가진단 시뮬레이션의 「출력」 → 「PDF로 저장」으로 다시 저장해 넣어 주세요.`);
            continue;
          }
          applySimulation(sim, stamp);
          simLoaded = true;
        } else if (kind === 'track') {
          state.trackDoc = { ...stamp, checks: E.checkTrackDoc(R, text).checks.map((c) => ({ id: c.id, ok: c.ok, missing: c.missing })) };
        } else {
          docErrors.push(`${file.name}: 자가진단 시뮬레이션 PDF가 아닙니다. 포털 졸업관리의 자가진단 시뮬레이션 화면에서 저장한 파일을 넣어 주세요.`);
        }
      } catch (err) {
        docErrors.push(`${file.name}: ${err.message || 'PDF를 읽지 못했습니다.'}`);
      }
    }
    docBusy = null;
    save();
    // 시뮬레이션을 새로 읽었으면 다음 단계(목적 고르기)로
    if (simLoaded && !docErrors.length) { showTab('purpose'); return; }
    render();
  }

  function bindDocInput() {
    const input = $('doc-files');
    input.addEventListener('change', async (e) => { await handleDocFiles([...e.target.files]); e.target.value = ''; });
    const zone = $('drop-zone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      handleDocFiles([...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'));
    });
  }

  // 다음 학기 한도 미리보기: 혁신융합 과목 없을 때 / 있을 때
  function nextCapLine(p, bonus, autoLoad) {
    const prof = { ...p, bonus };
    const prev = E.currentLoad(R, prof, state.taken);
    const innovItem = R.courses.find((c) => R.creditBonus.innovation.modules.includes(c.module));
    const show = (c) => `${c.cap}학점` + (c.parts.length ? ` (기본 ${c.base}${c.parts.map((x) => ` ${x.credits < 0 ? '−' : '+'} ${x.label} ${Math.abs(x.credits)}`).join('')})` : '');
    const plain = E.semesterCap(R, prof, 0, [], prev);
    const withInnov = E.semesterCap(R, prof, 0, [{ id: innovItem.id }], prev);
    return `▶ 다음 학기 한도 ${show(plain)}` + (withInnov.cap !== plain.cap ? `, 혁신융합 과목을 들으면 ${show(withInnov)}.` : bonus.gpaHigh ? ' — 성적초과를 받으므로 혁신융합 과목을 들어도 같습니다.' : '.');
  }

  // ───────── 1. 기본 정보 ─────────
  function renderBasic() {
    const p = state.profile;
    const terms = [];
    for (let y = 1; y <= 6; y++) for (let t = 1; t <= 2; t++) terms.push([`${y}-${t}`, y <= 4 ? `${y}학년 ${t}학기` : `${y}학년 ${t}학기 (${(y - 1) * 2 + t}학기 · 초과학기)`]);
    const left = regularLeft();
    const labels = p.year ? E.semesterLabels(planStart(), Math.max(0, left + (Number(p.extraSemesters) || 0)) || 1) : [];

    // 시뮬레이션 PDF로 다 채워졌으면 한 줄 요약만 (「고치기」로 펼침)
    const filled = !!(state.portal && p.studentType && p.entryYear && R.curricula[p.curriculum] && p.year);
    const editing = !filled || openCards.has('edit-basic');
    const cohort = E.cohortYear(p);
    const summaryRow = filled ? h('div', { class: 'field basic-summary' },
      h('div', { class: 'field-row' }, h('div', { class: 'field-label' }, h('label', {}, '내 정보')),
        h('div', { class: 'control' }, h('b', {}, `${String(cohort).slice(2)}학번 교육과정`), h('span', {}, ` · ${p.studentType === 'transfer' ? `편입생 (${p.entryYear}년 ${p.transferGrade || 3}학년 편입)` : `일반 재학생 (${p.entryYear}년 입학)`} · 현재 ${p.year}학년 ${p.term}학기${semesterNo() > 8 ? ` (${semesterNo()}학기 · 초과학기)` : ''}`)),
        h('button', { class: 'link', onclick: () => toggleSet(openCards, 'edit-basic', render) }, editing ? '접기' : '고치기'))) : null;
    const rows = editing ? [
      summaryRow,
      field('학생 구분', radios('stype', p.studentType, [['regular', '일반 재학생'], ['transfer', '편입생', '전적대 인정 학점 입력']], (v) => update({ studentType: v })), { required: true }),
      p.studentType ? entryField(p) : null,
      field('현재 학년·학기', h('select', { id: 'f-term', onchange: (e) => { const [y, t] = e.target.value.split('-').map(Number); update({ year: y || null, term: t || null }); } },
        h('option', { value: '' }, '선택'), terms.map(([v, l]) => h('option', { value: v, selected: v === `${p.year}-${p.term}` }, l))),
      { id: 'f-term', required: true, hint: '이번 학기에 듣고 있는 과목은 다음 단계에서 「수강 중」으로 입력하세요.' }),
    ] : [summaryRow];
    // 남은 학기·학점 한도는 대부분 기본값으로 충분 — 「조정 (선택)」 안에 접어 둔다
    const adjust = [];
    // 남은 학기·학점 한도는 수강 계획에서만 쓴다
    const planning = state.mode === 'plan';
    if (planning && p.year) {
      adjust.push(field('남은 학기', h('div', { class: 'inline' },
        h('span', {}, semesterNo() >= 8 ? (semesterNo() > 8 ? '초과학기 중 — 이번 학기 다음에 더 다닐 학기 ' : '이번 학기가 정규 마지막 학기 — 이후 더 다닐 학기(초과학기) ') : `이번 학기 제외 정규 ${left}학기 + 추가 `),
        h('input', { type: 'number', min: 0, max: 6, value: p.extraSemesters, class: 'num-input', 'aria-label': '추가 학기', onchange: (e) => update({ extraSemesters: Math.max(0, Number(e.target.value) || 0) }) }),
        h('span', {}, '학기')),
      { note: left + (Number(p.extraSemesters) || 0) > 0 ? `계획 대상: ${labels[0]} ~ ${labels[labels.length - 1]}` : '이번 학기가 마지막 학기입니다. 부족하면 추가 학기를 늘려 계획해 보세요.' }));
    }
    // 학기당 최대 학점은 학사종합안내 기준(19) 고정이라 입력받지 않는다
    if (planning) {
      const B = R.creditBonus;
      const bonus = p.bonus || {};
      const autoLoad = E.currentLoad(R, { bonus: {} }, state.taken);
      const minCr = R.minCreditsPerSemester.value;
      adjust.push(field('다음 학기 수강 한도', h('div', { class: 'checks' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: bonus.gpaHigh, onchange: (e) => update({ bonus: { ...bonus, gpaHigh: e.target.checked } }) }),
          ` 이번 학기 평점 ${B.gpa.minGpa.toFixed(1)} 이상 (예상) → 성적초과 +${B.gpa.credits}`),
        h('label', { class: 'check' }, ' 이번 학기 수강 학점 ',
          h('input', { type: 'number', min: 0, max: 30, value: bonus.currentLoad, placeholder: String(autoLoad), class: 'num-input', 'aria-label': '이번 학기 수강 학점',
            onchange: (e) => update({ bonus: { ...bonus, currentLoad: e.target.value } }) }),
          ` 학점 → ${R.maxCreditsPerSemester.value}학점보다 덜 신청한 만큼 최대 ${B.carry.max}학점 이월 (${minCr}학점 미만이면 이월 없음)`),
        h('label', { class: 'check' }, ' 이번 방학 산업체현장실습 ',
          h('input', { type: 'number', min: 0, max: 4, value: bonus.fieldPractice || 0, class: 'num-input', 'aria-label': '산업체현장실습 학점',
            onchange: (e) => update({ bonus: { ...bonus, fieldPractice: Number(e.target.value) || 0 } }) }),
          ' 학점 → 다음 학기 한도에서 차감')),
      { note: nextCapLine(p, bonus, autoLoad),
        hint: [
        `성적초과와 혁신융합(바이오헬스 등 혁신융합대학 과목을 듣는 학기)은 둘 중 하나만 +${B.innovation.credits}학점입니다. 성적초과를 체크하지 않으면 혁신융합 과목을 넣은 학기에 자동으로 붙습니다. 이월은 둘 다와 함께 받을 수 있고, 다음 학기에 쓰지 않으면 사라집니다.`,
        bonus.currentLoad === '' || bonus.currentLoad == null
          ? (autoLoad ? `이번 학기 수강 학점은 「수강 중」 과목 합계(${autoLoad}학점)를 씁니다.` : '이번 학기 수강 학점을 비워 두면 「수강 과목」의 「수강 중」 과목 합계를 씁니다. 아직 넣은 과목이 없어 지금은 0학점이라 이월이 계산되지 않습니다.')
          : null,
      ].filter(Boolean).join(' '),
        sourceId: B.sourceId, key: 'bonus' }));
    }

    if (adjust.length) {
      const bonus = p.bonus || {};
      const prof = { ...p, bonus };
      const cap = E.semesterCap(R, prof, 0, [], E.currentLoad(R, prof, state.taken)).cap;
      const leftN = Math.max(0, left + (Number(p.extraSemesters) || 0));
      rows.push(h('details', { class: 'field adjust', open: openCards.has('adjust') || undefined, ontoggle: (e) => { if (e.target.open) openCards.add('adjust'); else openCards.delete('adjust'); } },
        h('summary', {}, h('b', {}, '학점 한도·남은 학기 조정'), h('span', { class: 'meta' }, ` (선택) — 남은 ${leftN}학기 · 다음 학기 한도 ${cap}학점`)),
        adjust));
    }
    // 전적대 인정 학점은 시뮬레이션 PDF·성적표에서 채운다. 직접 고치기는 접어 둔다.
    // (기준 학기 선택은 2026-11-06 화면에서 뺐다 — 늘 현재 기준)
    if (p.studentType === 'transfer') {
      const tc = p.transferCredits;
      const total = R.transferAreas.reduce((s, a) => s + (Number(tc[a.key]) || 0), 0);
      const summary = total
        ? R.transferAreas.filter((a) => Number(tc[a.key]) > 0).map((a) => `${a.label} ${tc[a.key]}`).join(' · ')
        : '아직 없음 — 「자료 첨부」에서 시뮬레이션 PDF를 넣으면 자동으로 채워집니다';
      rows.push(h('div', { class: 'field' },
        h('div', { class: 'field-row' }, h('label', {}, '전적대 인정 학점'),
          h('div', { class: 'control' }, h('b', {}, `${total}학점`), h('span', { class: 'meta' }, ` ${summary}`)),
          h('button', { class: 'link', onclick: () => toggleSet(openSources, 'edit-transfer', render) }, openSources.has('edit-transfer') ? '닫기' : '직접 고치기')),
        openSources.has('edit-transfer') ? h('div', { class: 'grid4' }, R.transferAreas.map((a) => h('label', { class: 'mini-field' }, a.label,
          h('input', { type: 'number', min: 0, max: 100, value: tc[a.key] || 0, onchange: (e) => update({ transferCredits: { ...tc, [a.key]: Number(e.target.value) || 0 } }) })))) : null));
    }
    // 사회봉사·공인외국어 등 과목 외 졸업요건은 졸업 시점 기준(최신 학사종합안내)이라 기준 학기와 무관하다.
    $('basic-form').replaceChildren(...rows.filter(Boolean));
  }

  // 입학년도 → 적용 학번·교육과정. 편입생은 편입년도와 편입 학년으로 부여 학번을 계산한다.
  const FIRST_COHORT = Math.min(...Object.values(R.curricula).map((c) => c.fromYear || 9999));
  function entryField(p) {
    const transfer = p.studentType === 'transfer';
    const lastYear = new Date().getFullYear(); // 올해 입학(편입)까지
    const years = [];
    for (let y = lastYear; y >= FIRST_COHORT + (transfer ? 1 : 0); y--) years.push(y);
    const cohort = E.cohortYear(p);
    const cur = p.entryYear ? R.curricula[E.curriculumForProfile(R, p)] : null;
    const control = h('div', { class: 'inline' },
      h('select', { id: 'f-entry', onchange: (e) => update({ entryYear: Number(e.target.value) || null }) },
        h('option', { value: '' }, '선택'), years.map((y) => h('option', { value: y, selected: Number(p.entryYear) === y }, `${y}년`))),
      transfer ? h('select', { 'aria-label': '편입 학년', onchange: (e) => update({ transferGrade: Number(e.target.value) }) },
        [2, 3].map((g) => h('option', { value: g, selected: (Number(p.transferGrade) || 3) === g }, `${g}학년 편입`))) : null);
    let note = null;
    if (p.entryYear && cur) {
      note = h('span', {}, `→ ${String(cohort).slice(2)}학번 교육과정 적용: ${cur.label}`);
    } else if (p.entryYear) {
      note = h('span', { class: 'bad-text' }, `${String(cohort).slice(2)}학번 교육과정은 아직 지원하지 않습니다 (${String(FIRST_COHORT).slice(2)}학번부터).`);
    }
    const reqSrc = cur ? cur.requirements.find((r) => r.kind === 'allOf').sourceId : null;
    return field(transfer ? '편입년도' : '입학년도', control, {
      id: 'f-entry', note, required: true,
      hint: transfer ? '편입생은 부여받은 학번의 교육과정을 따릅니다. 예: 2025년 3학년 편입 → 23학번 교육과정.' : '입학한 해로 학번별 졸업 기준(전공필수·교양 학점 등)이 정해집니다.',
      sourceId: reqSrc, key: 'cur',
    });
  }

  // ───────── 2. 수강 과목 ─────────
  // 과목을 포털처럼 영역별로 묶어 보여준다. 출처: sim(시뮬레이션 PDF) / paste(붙여넣기) / manual(직접)
  const SRC_LABEL = { sim: 'PDF', paste: '붙여넣기', manual: '직접' };
  // 모듈 지도 아래 「그 밖의 과목」: 학과 교과목표에 없는 과목만 (학과 교과목은 지도에서 다룬다)
  const COURSE_GROUPS = [
    ['majorx', '전공 (학과 교과목 외)', (r) => r.kind === 'major'],
    ['base', '학과(부)기초', (r) => r.kind === 'base'],
    ['gen', '교양', (r) => r.kind === 'gen'],
    ['free', '자유선택', (r) => r.kind === 'free'],
    ['other', '타과 과목 (자유선택)', (r) => r.kind === 'other'],
  ];
  const nextStatus = { none: 'done', done: 'inprogress', inprogress: 'none' };
  const normName = (x) => String(x || '').replace(/^_/, '').replace(/\s+/g, '');

  // 8학기 이상인데 졸업요건이 남았으면: 9학기 등록 안내 (학사종합안내 [3.주요학사제도] p.1–2, S-OVER)
  function overNotice(ev) {
    const n = semesterNo();
    if (!n || n < 8 || ev.allSatisfied) return null;
    return h('div', { class: 'warning info' }, n === 8
      ? '이번 학기(8학기)에 졸업요건을 다 채우지 못하면 9학기 등록이 필요합니다. 8개 학기 이상 등록하고 졸업요건을 못 채운 학생은 수강신청 후 등록해야 하며, 등록하지 않으면 제적됩니다. 9학기 등록자는 다음 학기로 학점 이월이 없습니다.'
      : `초과학기(${n}학기) 중입니다. 졸업요건을 채울 때까지 매 학기 수강신청 후 등록해야 하며, 등록하지 않으면 제적됩니다. 9학기 이상 등록자는 다음 학기로 학점 이월이 없습니다.`);
  }

  // F·NP 안내: 학점이 인정되지 않으니 필수면 재수강, 아니면 다른 과목으로 학점을 채워야 한다
  function failedNotice() {
    const failed = state.taken.filter((t) => t.status === 'failed');
    if (!failed.length) return null;
    const cur = R.curricula[state.profile.curriculum];
    const req = new Set([...(cur ? cur.requirements.find((r) => r.kind === 'allOf').courses : []), ...(state.profile.trackChoice === 'yes' && state.profile.tracks.length ? R.trackCommonRequired.courses : [])]);
    const name = (t) => (t.custom ? t.name : courseName(t.id)) + ` ${t.grade || 'F'}`;
    const must = failed.filter((t) => !t.custom && req.has(t.id)), rest = failed.filter((t) => t.custom || !req.has(t.id));
    return h('div', { class: 'warning warn' },
      `F·NP를 받은 과목 ${failed.length}개는 학점으로 인정되지 않아 판정에서 뺐습니다. `,
      must.length ? [h('b', {}, `필수 과목 ${must.map(name).join(', ')}`), '은(는) 재수강해야 합니다. '] : null,
      rest.length ? `${rest.map(name).join(', ')}은(는) 재수강하거나 다른 과목으로 학점을 채우면 됩니다.` : null);
  }

  // 지도에서 과목 상태 바꾸기: 미이수 → 이수 → 수강 중 → 미이수
  function cycleCourse(id) {
    const idx = state.taken.findIndex((t) => !t.custom && t.id === id);
    let cur = idx < 0 ? 'none' : (state.taken[idx].status || 'done');
    if (cur === 'failed') cur = 'none';
    const next = nextStatus[cur];
    if (next === 'none') state.taken.splice(idx, 1);
    else if (idx < 0) state.taken.push({ id, status: next, src: 'manual' });
    else state.taken[idx] = { ...state.taken[idx], status: next };
    state.plan = null;
    save();
    render();
  }

  function renderCourses() {
    const p = state.profile;
    const done = E.itemsFor(R, state.taken, ['done']).reduce((s, i) => s + i.credits, 0);
    const inprog = E.itemsFor(R, state.taken, ['inprogress']).reduce((s, i) => s + i.credits, 0);
    $('taken-count').textContent = `${state.taken.length}과목 · 이수 ${done}학점 · 수강 중 ${inprog}학점`;

    // 어디서 읽었는지
    const pt = state.portal;
    const fromSim = state.taken.filter((t) => t.src === 'sim').length;
    const src = [];
    // 맨 위 안내는 강조 없이 글만 (오류만 빨간 상자)
    if (pt && !fromSim && state.taken.length) src.push(h('p', { class: 'top-note' }, `과목 ${state.taken.length}개가 입력되어 있습니다.`));
    else if (pt) src.push(h(fromSim ? 'p' : 'div', { class: fromSim ? 'top-note' : 'warning error' }, fromSim
      ? `자가진단 시뮬레이션 PDF(${pt.fileName || '파일'})에서 과목 ${fromSim}개를 가져왔습니다${p.asOf ? ` (${p.asOf}까지 — 「기본 정보」의 기준 학기)` : ''}. 빠진 과목은 아래 학과 교과목에서 눌러 표시하세요.`
      : `시뮬레이션 PDF(${pt.fileName || '파일'})에서 과목을 하나도 읽지 못했습니다. PDF 마지막 쪽 「영역별 이수 교과목 현황」이 있는지 확인하세요. 들은 과목은 아래 학과 교과목에서 눌러 표시할 수 있습니다.`));
    $('taken-source').replaceChildren(...src, ...[failedNotice()].filter(Boolean));

    renderTrackForm();
    // 트랙 이수 여부를 고르기 전에는 아래 내용을 숨긴다. 고르면 「짠」 하고 나타난다(트랙 이수면 트랙을 하나 이상 고른 뒤).
    const chosen = p.trackChoice === 'no' || (p.trackChoice === 'yes' && p.tracks.length > 0);
    const body = $('course-body');
    if (chosen && body.hidden) { body.classList.remove('reveal'); void body.offsetWidth; body.classList.add('reveal'); }
    body.hidden = !chosen;
    $('choose-first').hidden = chosen;
    $('choose-first').textContent = p.trackChoice === 'yes' ? '이수할 트랙을 모두 골라 주세요.' : '먼저 트랙 이수 여부를 골라 주세요.';
    $('track-next').disabled = !chosen;
    const ev = ready() ? E.evaluate(R, engineProfile(), state.taken, 'predict') : null;
    renderMapSummary(ev);
    renderModuleMap(ev);

    // 그 밖의 과목 (학과 교과목표에 없는 과목) + 전적대 인정
    const tr = p.studentType === 'transfer' ? p.transferCredits : null;
    const trTotal = tr ? R.transferAreas.reduce((s, a) => s + (Number(tr[a.key]) || 0), 0) : 0;
    const blocks = [];
    if (trTotal) {
      blocks.push(h('div', { class: 'guide-block course-group' },
        h('h4', {}, '전적대 인정', h('span', { class: 'meta' }, ` ${trTotal}학점`)),
        h('div', { class: 'hint' }, R.transferAreas.filter((a) => Number(tr[a.key]) > 0).map((a) => `${a.label} ${tr[a.key]}`).join(' · '), ' — ',
          h('button', { class: 'link', onclick: () => showTab('basic') }, '「기본 정보」에서 고치기'))));
    }
    const noTrack = p.trackChoice === 'no';
    const rows = state.taken.map((t, idx) => ({ t, idx, r: E.resolveEntry(t, CAT, R) })).filter(({ r }) => r.custom || r.unknown || (noTrack && (r.kind === 'other' || (CAT[r.cid] && CAT[r.cid].discontinued))));
    // 트랙 판단에는 필요 없으니 접어 두고 「n과목 · m학점」(이수 + 수강 중)만 보인다. ▸ 를 누르면 펼친다.
    for (const [key, title, test] of COURSE_GROUPS) {
      const list = rows.filter(({ r }) => test(r));
      if (!list.length) continue;
      const credits = list.reduce((s, { r }) => s + r.credits, 0);
      const inprogN = list.filter(({ t }) => (t.status || 'done') === 'inprogress').length;
      const openKey = 'grp-' + key;
      blocks.push(h('details', { class: 'guide-block course-group fold-group', open: openCards.has(openKey) || undefined,
        ontoggle: (e) => { if (e.target.open) openCards.add(openKey); else openCards.delete(openKey); } },
        h('summary', {}, h('b', {}, title), h('span', { class: 'meta' }, ` ${list.length}과목 · ${credits}학점` + (inprogN ? ` (수강 중 ${inprogN}과목 포함)` : ''))),
        h('ul', { class: 'taken-list' }, list.map(({ t, idx, r }) => h('li', { class: (t.status || 'done') === 'inprogress' ? 'inprog' : '' },
          h('span', { class: 'name' }, r.name,
            h('span', { class: 'meta' }, ` · ${r.credits}학점`),
            t.term ? h('span', { class: 'meta' }, ` · ${t.term}`) : null,
            t.src ? badge('muted', SRC_LABEL[t.src]) : null),
          r.custom ? h('select', { 'aria-label': '이수 영역', onchange: (e) => { state.taken[idx] = { ...t, area: e.target.value, major: undefined }; state.plan = null; save(); render(); } },
            Object.entries(E.AREAS).map(([k, l]) => h('option', { value: k, selected: r.kind === k }, l))) : null,
          h('select', { 'aria-label': '상태', onchange: (e) => { state.taken[idx] = { ...t, status: e.target.value }; state.plan = null; save(); render(); } },
            ['done', 'inprogress', 'failed'].map((st) => h('option', { value: st, selected: (t.status || 'done') === st }, STATUS_LABEL[st]))),
          h('button', { class: 'link danger', onclick: () => { state.taken.splice(idx, 1); state.plan = null; save(); render(); } }, '삭제'))))));
    }
    if (!blocks.length) blocks.push(h('div', { class: 'hint' }, '교양·타 학과 과목 등 학과 교과목이 아닌 과목은 아래에서 추가합니다.'));
    // 트랙 안 함이면 교양·타과 과목을 자유롭게 듣는 경우가 많아 과목 추가를 조금 더 눈에 띄게
    document.querySelector('.add-box').classList.toggle('emph', noTrack);
    $('add-hint').textContent = `학과 교과목이 아닌 과목(교양·타 학과 등)이 빠졌으면 여기서 넣으세요. 학과 교과목은 위 ${noTrack ? '표' : '모듈'}에서 누르면 됩니다.`;
    $('taken-groups').replaceChildren(...blocks);
  }

  const trackShort = (id) => R.tracks[id].short || R.tracks[id].name;

  // 트랙 고르기: 트랙 안 함 / 트랙 이수 + 트랙 버튼 (최대 maxTracks개)
  function renderTrackForm() {
    const p = state.profile;
    const choice = radios('tchoice', p.trackChoice, [['no', '트랙 안 함'], ['yes', '트랙 이수', `최대 ${R.maxTracks}개`]], (v) => update({ trackChoice: v }));
    const pills = p.trackChoice === 'yes' ? h('div', { class: 'track-pills' }, Object.entries(R.tracks).map(([k, t]) => {
      const on = p.tracks.includes(k);
      const full = !on && p.tracks.length >= R.maxTracks;
      const mods = [...new Set(t.parts.flatMap((x) => x.modules))].join('·');
      return h('button', { class: 'track-pill' + (on ? ' on' : ''), 'aria-pressed': String(on), disabled: full, title: `모듈 ${mods}` + (t.convertsToMajor ? ' · 이수 시 타과 과목 전공 인정' : ''),
        onclick: () => update({ tracks: on ? p.tracks.filter((x) => x !== k) : [...p.tracks, k] }) }, on ? '✓ ' : '', t.name);
    })) : null;
    $('track-form').replaceChildren(h('div', { class: 'track-form' },
      h('div', { class: 'inline' }, h('b', { class: 'tf-label' }, '트랙'), choice,
        p.trackChoice === 'yes' ? tip('한 과목은 고른 트랙 모두에 인정됩니다. 트랙 이수 신청은 학기마다 한 번 있으니 학과 홈페이지·과톡방 공지를 확인하세요.') : null,
        sourceToggle('track-src', 'S-OFFICE', render)[0]),
      pills,
      openSources.has('track-src') ? sourceView('S-OFFICE') : null,
));
  }

  // 위쪽 요약 숫자 + 트랙별 진행표 (수강 중 포함 예측, 고른 트랙 이수 가정)
  function renderMapSummary(ev) {
    if (!ev) {
      $('map-summary').replaceChildren(h('div', { class: 'warning info' }, '「기본 정보」에서 입학년도·학년을 고르면 필수 과목과 전공 학점이 여기에 표시됩니다.'));
      $('track-progress').replaceChildren();
      $('map-notes').replaceChildren();
      return;
    }
    const reqOf = (kind) => ev.requirements.find((r) => r.kind === kind);
    const allOf = reqOf('allOf'), major = reqOf('majorTotal');
    const kpi = (label, value, of, unit, ok, sub, pct) => h('div', { class: 'kpi' + (ok ? ' ok' : '') },
      h('div', { class: 'kpi-label' }, label),
      h('div', { class: 'kpi-value' }, String(value), h('small', {}, ` / ${of}${unit}`), ok ? h('span', { class: 'kpi-ok' }, ' ✓') : null),
      pct != null ? h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.min(100, pct)}%` })) : null,
      sub ? h('div', { class: 'kpi-sub' + (ok ? '' : ' left') }, sub) : null);
    const tracksOk = ev.tracks.filter((t) => t.satisfied).length;
    $('map-summary').replaceChildren(...[
      allOf ? kpi(reqLabel(allOf.name), allOf.earned, allOf.needed, '과목', allOf.satisfied, allOf.missing.length ? '남음: ' + allOf.missing.map(courseName).join(', ') : null) : null,
      major ? kpi('전공 학점', major.earned, major.needed, '학점', major.satisfied, major.satisfied ? null : `${major.needed - major.earned}학점 남음`, (major.earned / major.needed) * 100) : null,
      ev.tracks.length ? kpi('트랙', tracksOk, ev.tracks.length, '개 충족', tracksOk === ev.tracks.length, null) : null,
    ].filter(Boolean));

    // 트랙별 진행표: 기준마다 한 칸 (채운 학점 / 기준)
    $('track-progress').replaceChildren(...ev.tracks.map((t) => {
      const okParts = t.parts.filter((x) => x.satisfied).length;
      return h('div', { class: 'track-row' + (t.satisfied ? ' ok' : '') },
        h('div', { class: 'tr-head' }, h('b', {}, t.name),
          h('span', { class: 'tr-state' }, t.satisfied ? '충족 ✓' : `기준 ${okParts}/${t.parts.length}`)),
        h('div', { class: 'tr-cells' }, t.parts.map((x) => h('div', { class: 'tr-cell' + (x.satisfied ? ' ok' : '') },
          h('span', { class: 'tr-cell-label' }, x.modules.length > 1 ? x.label.split(' ')[0] + ' 합계' : `${x.modules[0]} ${R.modules[x.modules[0]].name}`),
          h('span', { class: 'tr-cell-num' }, `${Math.min(x.earned, 99)}/${x.min}`),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.min(100, (x.earned / x.min) * 100)}%` }))))),
        t.commonMissing.length ? h('div', { class: 'tr-common' }, '공통 필수 남음: ' + t.commonMissing.map(courseName).join(', ')) : null);
    }));

    const cur = R.curricula[state.profile.curriculum];
    const curReq = cur.requirements.find((r) => r.kind === 'allOf');
    // 학번별 예외 안내만 (예: ~19학번 마케팅조사분석 대체 인정)
    const notes = [...(curReq.substitutes || []).map((sb) => `※ ${courseName(sb.course)}을 ${sb.fromTerm.slice(0, 4)}~${sb.toTerm.slice(0, 4)}학년도에 이수했다면 ${courseName(sb.for)} 대신 인정됩니다.`),
      ...(allOf && allOf.note ? ['※ ' + allOf.note] : [])];
    $('map-notes').replaceChildren(...(notes.length ? [h('div', { class: 'hint map-note' }, notes.map((t) => h('div', {}, t)))] : []));
  }

  // 모듈 지도: 기초 / 전공 모듈 / 융합 / 현장·진로로 묶어 보인다
  const MAP_GROUPS = [
    { title: '기초', modules: ['A', 'B', 'C'], note: '학문기초(A)는 교양으로 인정' },
    { title: '전공 모듈', modules: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'], note: '학과전공트랙은 이 중 5개 모듈에서 6학점씩' },
    { title: '융합 모듈', modules: ['M', 'N', 'O'], note: '타 학과 과목 · 푸드바이오경제 트랙 이수 시 전공 인정' },
    { title: '현장실습·진로', modules: ['P'], note: '직접 신청하는 과정', fold: true },
  ];
  function renderModuleMap(ev) {
    const p = state.profile;
    const cur = R.curricula[p.curriculum];
    const curReq = cur ? cur.requirements.find((r) => r.kind === 'allOf') : null;
    const reqIds = new Set(curReq ? curReq.courses : []);
    const tracks = ev ? ev.tracks : [];
    const commonIds = new Set(tracks.length ? R.trackCommonRequired.courses : []);
    const takenBy = new Map(state.taken.filter((t) => !t.custom).map((t) => [t.id, t]));
    // F·NP 받은 과목은 미이수로 보인다 (아래에 「F — 재수강 필요」)
    const stOf = (id) => { const t = takenBy.get(id); const st = t ? (t.status || 'done') : 'none'; return st === 'failed' ? 'none' : st; };

    // 트랙을 골랐으면, 고른 트랙과 무관한 전공·융합 모듈(필수 과목 없는 것)은 흐리게만 (들은 과목은 체크 가능 — 전공 학점에 들어간다)
    const tracksOn = tracks.length > 0;
    const trackMods = new Set(tracks.flatMap((t) => t.parts.flatMap((x) => x.modules)));
    const OPTIONAL = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']);

    const courseRow = (c, off) => {
      const st = stOf(c.id), t = takenBy.get(c.id);
      const oldName = t && t.raw && (c.formerNames || []).find((f) => normName(f) === normName(t.raw));
      const isReq = reqIds.has(c.id) || commonIds.has(c.id);
      const tipText = [STATUS_LABEL[st] || '미이수', t && t.term, t && t.src ? SRC_LABEL[t.src] : null,
        c.formerNames ? `동일교과목: ${c.formerNames.join('·')}` : null,
        reqIds.has(c.id) ? reqLabel(curReq.name) : commonIds.has(c.id) ? '트랙 공통 필수' : null, '— 눌러서 상태 바꾸기'].filter(Boolean).join(' · ');
      return h('li', {}, h('button', { class: 'course-toggle st-' + st, 'aria-pressed': String(st !== 'none'), title: off ? '고른 트랙에 필요하지 않은 모듈 — 들은 과목은 체크하면 전공 학점에 들어갑니다 · ' + tipText : tipText, onclick: () => cycleCourse(c.id) },
        h('span', { class: 'ct-dot st-' + st }),
        h('span', { class: 'ct-name' }, c.name,
          isReq ? h('span', { class: 'req-tag' + (st === 'none' ? ' missing' : '') }, '필수') : null,
          st === 'inprogress' ? h('span', { class: 'ct-state' }, '수강 중') : null,
          t && t.status === 'failed' ? h('span', { class: 'ct-sub fail' }, `${t.grade || 'F'} (${t.term || ''}) — 학점 미인정, ${isReq ? '재수강 필요' : '재수강하거나 다른 과목으로'}`)
            : oldName ? h('span', { class: 'ct-sub' }, `${oldName}(으)로 이수`) : c.discontinued ? h('span', { class: 'ct-sub' }, '폐지된 과목') : null),
        h('span', { class: 'ct-cr' }, c.credits)));
    };

    const moduleCard = (m) => {
      const mod = R.modules[m];
      // 폐지 과목(애그리비즈니스 등)은 들은 경우에만 보인다
      const list = R.courses.filter((c) => c.module === m && (!c.discontinued || stOf(c.id) !== 'none'));
      const total = list.reduce((s, c) => s + c.credits, 0);
      const gotCr = list.filter((c) => stOf(c.id) !== 'none').reduce((s, c) => s + c.credits, 0);
      const inTracks = tracks.filter((t) => t.parts.some((x) => x.modules.includes(m)));
      const reqLeft = list.filter((c) => (reqIds.has(c.id) || commonIds.has(c.id)) && stOf(c.id) === 'none').length;
      const hasReq = list.some((c) => reqIds.has(c.id) || commonIds.has(c.id));
      const off = tracksOn && OPTIONAL.has(m) && !trackMods.has(m) && !hasReq;
      // 이 모듈이 걸린 트랙 기준(합계 기준 포함)을 모두 채웠을 때만 「충족」
      const myParts = inTracks.flatMap((t) => t.parts.filter((x) => x.modules.includes(m)));
      const met = myParts.length > 0 && myParts.every((x) => x.satisfied);
      const left = Math.max(0, ...myParts.map((x) => x.min - x.earned));
      return h('div', { class: 'mod-card' + (inTracks.length ? ' in-track' : '') + (met ? ' met' : '') + (off ? ' off' : '') },
        h('div', { class: 'mod-head' },
          h('span', { class: 'mod-letter' }, m === 'P' ? '+' : m),
          h('b', { class: 'mod-name' }, mod.name),
          h('span', { class: 'mod-cr' }, `${gotCr}/${total}`)),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${total ? Math.round((gotCr / total) * 100) : 0}%` })),
        off ? h('div', { class: 'mod-meta' }, h('span', { class: 'mod-off' }, '트랙 필수 아님')) : null,
        inTracks.length || reqLeft ? h('div', { class: 'mod-meta' },
          inTracks.length ? h('span', { class: 'mod-tracks' }, inTracks.map((t) => trackShort(t.id)).join(' · ')) : null,
          inTracks.length ? h('span', { class: met ? 'mod-met' : 'mod-left' }, met ? '트랙 기준 충족 ✓' : `${left}학점 남음`) : null,
          reqLeft ? h('span', { class: 'mod-req' }, `필수 ${reqLeft}과목 남음`) : null) : null,
        h('ul', { class: 'mod-courses' }, list.map((c) => courseRow(c, off))));
    };

    // 트랙 안 함: 모듈 대신 학과 교육과정 표(붙임2 p.6)처럼 학년-학기별로 보인다
    if (p.trackChoice === 'no') {
      const T = R.curriculumTable;
      $('module-map').replaceChildren(...T.groups.map((g) => {
        const rows = g.rows.map((row) => {
          const list = row.courses.map((id) => CAT[id]).filter(Boolean);
          const got = list.filter((c) => stOf(c.id) !== 'none').length;
          return h('div', { class: 'cur-row' },
            h('div', { class: 'cur-term' }, h('b', {}, row.term), h('span', { class: 'meta' }, `${got}/${list.length}`)),
            h('ul', { class: 'mod-courses cur-courses' }, list.map((c) => courseRow(c, false))));
        });
        const head = [h('span', { class: 'map-group-title' }, g.title)];
        if (g.fold) return h('details', { class: 'map-group fold' }, h('summary', {}, ...head, h('span', { class: 'meta' }, '현장실습·캡스톤·진로세미나')), h('div', { class: 'cur-table' }, rows));
        return h('section', { class: 'map-group' }, h('div', { class: 'map-group-head' }, ...head), h('div', { class: 'cur-table' }, rows));
      }));
      return;
    }
    $('module-map').replaceChildren(...MAP_GROUPS.map((g) => {
      const cards = g.modules.filter((m) => R.modules[m] && R.courses.some((c) => c.module === m)).map(moduleCard);
      const head = [h('span', { class: 'map-group-title' }, g.title), h('span', { class: 'meta' }, g.note)];
      if (g.fold) return h('details', { class: 'map-group fold' }, h('summary', {}, ...head), h('div', { class: 'module-map' }, cards));
      return h('section', { class: 'map-group' }, h('div', { class: 'map-group-head' }, ...head), h('div', { class: 'module-map' }, cards));
    }));
  }

  function addTaken(entry) {
    if (state.taken.some((t) => t.id === entry.id)) return false;
    state.taken.push(entry);
    state.plan = null;
    save();
    return true;
  }

  function bindCourseInputs() {
    $('custom-add').addEventListener('click', () => {
      const name = $('custom-name').value.trim();
      const credits = Number($('custom-credits').value);
      if (!name || !(credits > 0)) return;
      addTaken({ custom: true, id: 'X-' + Date.now(), name, credits, area: $('custom-area').value, status: $('add-status').value, src: 'manual' });
      $('custom-name').value = '';
      render();
    });
  }

  // 기준 학기에 맞춰 시뮬레이션 과목을 다시 고른다. 직접 넣은 과목은 그대로 두되 기준 학기 이후 것은 뺀다.
  function rebuildTaken() {
    const p = state.profile;
    const others = state.taken.filter((t) => t.src !== 'sim');
    const sim = E.coursesAsOf(state.simCourses || [], p.asOf, { asOfDone: p.asOfDone });
    const simIds = new Set(sim.map((e) => e.id));
    const keep = E.coursesAsOf(others.filter((t) => !simIds.has(t.id)), p.asOf, { asOfDone: p.asOfDone });
    state.taken = [...sim, ...keep];
    state.plan = null;
  }
  // 자가진단 시뮬레이션 → 기본 정보·전적대 학점·과목·사회봉사 채우기 (이름·학번은 읽지 않음)
  function applySimulation(s, stamp) {
    const t = s.transcript;
    const patch = {};
    if (s.curriculum) patch.curriculum = s.curriculum;
    if (s.entryYear) {
      patch.entryYear = s.entryYear;
      if (s.studentType === 'transfer' && s.baseYear) patch.transferGrade = s.entryYear - s.baseYear + 1;
    } else if (s.baseYear && s.studentType === 'regular') patch.entryYear = s.baseYear;
    if (s.studentType) patch.studentType = s.studentType;
    if (s.year) { patch.year = s.year; patch.term = s.term; }
    if (Object.keys(t.transfer).length) patch.transferCredits = { ...state.profile.transferCredits, ...t.transfer };
    state.profile = { ...state.profile, ...patch, extra: { ...state.profile.extra, ...(s.service === 'P' ? { service: 'P' } : {}), ...(s.lang === 'P' ? { lang: 'P' } : {}), ...(s.thesis === 'P' ? { examPassed: true } : {}) } };
    state.simCourses = [
      ...t.found.map((f) => ({ id: f.id, status: f.status, term: f.term, raw: f.raw, grade: f.grade, src: 'sim' })),
      ...t.unmatched.map((u) => ({ custom: true, id: 'X-' + u.code, code: u.code, name: u.name, credits: u.credits, area: u.area || 'free', status: u.status, term: u.term, grade: u.grade, src: 'sim' })),
    ];
    state.profile = { ...state.profile, asOf: null };
    rebuildTaken();
    const transferTotal = Object.values(t.transfer).reduce((a, b) => a + b, 0);
    const courses = new Set([...t.found.map((f) => f.id), ...t.unmatched.map((u) => u.code)]).size;
    state.portal = { ...stamp, baseYear: s.baseYear, rows: s.rows, summary: { curriculum: s.curriculum, studentType: s.studentType, year: s.year, term: s.term, transferTotal, courses } };
    state.plan = null;
  }

  // ───────── 4. 졸업 현황 ─────────
  // 졸업 현황 (수강 계획과 같은 모양): 남은 학점 한 줄 → 안내 → 꼭 들어야 할 과목 → 트랙 → 학점 외 졸업 요건(입력) → 학점 자세히(접힘) → 기준 출처(접힘)
  // 늘 「이번 학기 이후 예측」(수강 중 과목 이수, 고른 트랙 이수 가정) 기준.
  function renderStatus() {
    if (!ready()) return;
    const prof = engineProfile();
    const need = E.remainingNeeds(R, prof, state.taken);
    const ev = need.evaluation;
    const reqOf = (kind, area) => ev.requirements.find((r) => r.kind === kind && (!area || r.area === area));
    const left = (id) => { const c = need.credits.find((x) => x.id === id); return c ? c.left : 0; };

    // 맨 위: 졸업까지 남은 학점
    // 앞으로 들을 학점 = 졸업 총학점 남은 것과 영역(전공·학과기초·교양) 남은 것의 합 중 큰 쪽.
    // 총학점은 넘었어도 전공이 모자라면 그만큼은 더 들어야 한다.
    const parts = [['MAJOR', '전공'], ['BASE', '학과기초'], ['GEN', '교양']].map(([id, label]) => [label, left(id)]).filter(([, n]) => n > 0);
    const areaLeft = parts.reduce((a, [, n]) => a + n, 0);
    const totalLeft = Math.max(left('TOTAL'), areaLeft);
    const freeLeft = totalLeft - areaLeft;
    const creditsOk = !totalLeft && !parts.length;
    $('status-summary').replaceChildren(...[
      creditsOk ? h('h3', { class: 'plan-total' }, '학점 기준 ', h('span', { class: 'plan-total-num' }, '모두 채웠습니다 ✓'))
        : h('h3', { class: 'plan-total' }, '졸업까지 남은 학점 ', h('span', { class: 'plan-total-num' }, `${totalLeft}학점`)),
      !creditsOk ? h('p', { class: 'plan-breakdown' }, parts.map(([label, n]) => `${label} ${n}학점`).join(' · ') + (freeLeft ? `${parts.length ? ' · ' : ''}나머지 ${freeLeft}학점은 아무 과목(자유선택)` : '')) : null,
    ].filter(Boolean));

    // 안내: F·NP / 놓치면 부족해지는 기준 / 트랙 이수 가정
    const notes = [];
    const fragile = [
      ...ev.requirements.filter((r) => r.fragile).map((r) => ({ name: r.name, f: r.fragile })),
      ...ev.tracks.flatMap((t) => t.parts.filter((x) => x.fragile).map((x) => ({ name: `${trackShort(t.id)} ${x.label.split(' (')[0]}`, f: x.fragile }))),
    ];
    if (fragile.length) {
      const courses = [...new Set(fragile.flatMap((x) => x.f.risky))];
      notes.push(h('div', { class: 'warning warn' }, `⚠ 수강 중인 ${courses.join(', ')} 중 하나라도 이수하지 못하면 부족해지는 기준이 있습니다: ${fragile.map((x) => x.name).join(', ')}`));
    }
    if (ev.assumedTracks.length && ev.convertedCredits) {
      const strict = E.evaluate(R, prof, state.taken, 'predictStrict');
      const strictMajor = strict.requirements.find((r) => r.kind === 'majorTotal').earned;
      const assumedNames = ev.tracks.filter((t) => ev.assumedTracks.includes(t.id)).map((t) => t.name).join(', ');
      const lastTerm = prof.remainingSemesters === 0;
      notes.push(h('div', { class: 'warning ' + (lastTerm ? 'error' : 'info') }, lastTerm
        ? `이번 학기가 마지막인데 ${assumedNames} 트랙 기준이 아직 남아 있습니다. 트랙을 마치지 못하면 타과 과목 ${ev.convertedCredits}학점은 자유선택으로 남고 전공은 ${strictMajor}학점이 됩니다.`
        : [`${assumedNames} 트랙 이수를 가정해 타과 ${ev.convertedCredits}학점을 전공으로 계산했습니다. `,
          tip(`대상: ${ev.convertedItems.map((i) => i.name).join(', ')}. 실제 전공 인정은 트랙 기준을 다 채운 뒤이고, 못 마치면 이 학점은 자유선택으로 남아 전공은 ${strictMajor}학점입니다.`)]));
    }
    $('status-notes').replaceChildren(...[failedNotice(), overNotice(ev), ...notes].filter(Boolean));

    const blocks = [];
    // 꼭 들어야 할 과목
    blocks.push(h('h4', { class: 'need-sub' }, '꼭 들어야 할 과목 ', h('span', { class: 'meta' }, need.must.length ? `${need.must.length}과목 남음` : '모두 들었습니다 ✓')));
    if (need.must.length) blocks.push(h('ul', { class: 'must-list' }, need.must.map((m) => h('li', {}, h('b', {}, m.name),
      h('span', { class: 'meta' }, ` ${m.credits}학점 · ${reqLabel(m.reason)}` + (m.offered.length ? ` · 표준 ${m.offered.join('·')}학기 개설` : ''))))));
    // 트랙
    if (ev.tracks.length) {
      blocks.push(h('h4', { class: 'need-sub' }, '트랙 ', h('span', { class: 'meta' }, `${ev.tracks.filter((t) => t.satisfied).length}/${ev.tracks.length} 충족`)));
      blocks.push(h('ul', { class: 'must-list' }, ev.tracks.map((t) => {
        const rest = t.parts.filter((x) => !x.satisfied).map((x) => `${x.label.split(' (')[0]} ${x.min - x.earned}학점`);
        if (t.commonMissing.length) rest.push(`공통 필수 ${t.commonMissing.map(courseName).join(', ')}`);
        return h('li', { class: 'row-line' }, h('b', {}, t.name), t.satisfied ? h('span', { class: 'st-ok' }, '충족 ✓') : h('span', { class: 'st-no' }, '남음: ' + rest.join(', ')));
      })));
    }
    // 학점 외 졸업 요건: 요건만 자세히 적고, 학생이 포털에서 확인한 뒤 「충족」만 체크한다
    const x = state.profile.extra;
    const L = R.languageCert, S = R.service;
    const yt = R.youtubePoints.map((y) => `${y.people}인${y.orMore ? ' 이상' : ''} ${y.points}점`).join(' · ');
    const cur = R.curricula[state.profile.curriculum];
    const svcReq = cur.requirements.find((r) => r.kind === 'service');
    const NONCREDIT = {
      exam: {
        desc: ['졸업논문(졸업시험)에 합격해야 합니다.',
          `면제: TOEIC ${R.examExemptToeic}점 이상(유효기간 내) · 학과 인정 외부 경연대회 입상(입학 이후, 교수 승인) · 국내외 전문학술지 게재 · 비교과 포인트 ${R.examExemptPoints}점 이상`,
          `비교과 포인트: 학과 유튜브 채널 영상(교수 심사 통과) ${yt}`],
        portal: '포털 자가진단 시뮬레이션의 「졸업논문 통과여부」가 P이면 충족',
        on: { examPassed: true }, off: { examPassed: false, contest: false, journal: false, points: 0, toeic: '' },
      },
      lang: {
        desc: [`공인영어 중 하나: ${L.tests.map((t) => `${t.label} ${t.min}${t.note ? `(${t.note})` : ''}`).join(' · ')}`,
          `또는 ${L.routes.map((r) => r.label).join(' · ')}`,
          '입학 후 취득한 성적, 제출 당시 유효기간(2년) 이내만 인정. 편입생은 직전 전적대학에서 인정받은 점수가 기준 이상이면 인정'],
        portal: '포털 자가진단 시뮬레이션의 「공인외국어 P/F」가 P이면 충족',
        notice: '공인외국어 성적은 포털에 직접 등록해야 인정됩니다. 점수를 받았으면 먼저 포털에 등록하세요.',
        on: { lang: 'P' }, off: { lang: 'N', langScore: '', langRoutes: [], toeic: '' },
      },
      service: {
        desc: [`봉사 ${S.totalHours}시간 이상 (현장봉사 + 온라인특강)`,
          `사회봉사 온라인특강 ${S.minOnlineLectures}강좌 이상 필수, 강좌당 ${S.hoursPerOnlineLecture}시간` + (svcReq && svcReq.maxOnlineLectures > 1 ? ` (최대 ${svcReq.maxOnlineLectures}강좌까지 인정)` : ''),
          `교내 봉사 최대 ${S.campusMaxHours}시간 · 헌혈 1회 ${S.bloodDonationHours}시간 · VMS·1365 인증 봉사만 인정. 편입생은 전적대 성적표에 이수가 기재되어야 인정`],
        portal: '포털 자가진단 시뮬레이션의 「사회봉사 P/F」가 P이면 충족',
        on: { service: 'P' }, off: { service: 'N', serviceLectures: 0, serviceFieldHours: 0, serviceCampusHours: 0, serviceBlood: 0, serviceOnline: false },
      },
    };
    const nonCredit = ['exam', 'lang', 'service'].map((k) => reqOf(k)).filter(Boolean);
    blocks.push(h('h4', { class: 'need-sub' }, '학점 외 졸업 요건 ', h('span', { class: 'meta' }, nonCredit.every((r) => r.satisfied) ? '모두 충족 ✓' : '포털에서 확인한 뒤 충족이면 체크하세요')));
    blocks.push(h('div', { class: 'req-items' }, nonCredit.map((r) => {
      const d = NONCREDIT[r.kind];
      return h('div', { class: 'req-item' + (r.satisfied ? ' ok' : '') },
        h('div', { class: 'req-head' }, h('b', {}, r.name),
          h('label', { class: 'req-check' }, h('input', { type: 'checkbox', checked: r.satisfied, onchange: (e) => updateExtra(e.target.checked ? d.on : d.off) }), ' 충족'),
          h('span', { class: 'req-portal' }, d.portal)),
        h('ul', { class: 'req-desc' }, d.desc.map((t) => h('li', {}, t))),
        d.notice ? h('p', { class: 'req-notice' }, '※ ' + d.notice) : null);
    })));
    // 학점 자세히 (접힘): 영역별 표 + 전공으로 인정된 과목
    const major = reqOf('majorTotal');
    const allOf = reqOf('allOf');
    const row = (name, needed, earned, unit) => h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, `${needed}${unit}`), h('td', { class: 'num' }, `${earned}${unit}`),
      h('td', { class: 'num ' + (earned >= needed ? 'ok-text' : 'bad-text') }, earned >= needed ? '✓' : `${needed - earned}${unit}`));
    blocks.push(h('details', { class: 'credit-detail', open: openCards.has('credit-detail') || undefined, ontoggle: (e) => { e.target.open ? openCards.add('credit-detail') : openCards.delete('credit-detail'); } },
      h('summary', {}, '학점 자세히 보기'),
      h('table', { class: 'rep-table' }, h('thead', {}, h('tr', {}, h('th', {}, '영역'), h('th', {}, '기준'), h('th', {}, '채움'), h('th', {}, '남음'))),
        h('tbody', {}, need.credits.map((c) => row(c.name, c.needed, c.earned, '학점')), allOf ? row(reqLabel(allOf.name), allOf.needed, allOf.earned, '과목') : null)),
      major && major.counted.length ? [h('p', { class: 'hint' }, `전공으로 인정된 과목 ${major.counted.length}개` + (ev.convertedCredits ? ` (${ev.assumedTracks.length ? '트랙 이수 가정' : '트랙 인정'} 타과 ${ev.convertedCredits}학점 포함)` : '')),
        h('p', { class: 'counted-line' }, major.counted.map((i) => `${i.name}${i.status !== 'done' ? '(수강 중)' : ''}`).join(', '))] : null));
    $('status-body').replaceChildren(...blocks);

    // 판정 기준 출처 (접힘)
    const srcIds = [...new Set([...ev.requirements.map((r) => r.sourceId), ...(ev.tracks.length ? ['S-TRACKRULE', 'S-OFFICE'] : [])].filter(Boolean))];
    $('status-sources').replaceChildren(h('details', { class: 'sources-box' }, h('summary', {}, '판정 기준 출처'), srcIds.map((id) => sourceView(id))));
  }

  // ───────── 5. 수강 계획 ─────────
  const takenSig = () => state.taken.map((t) => `${t.id}:${t.status}`).sort().join('|');

  // 이수 과목이 바뀌었으면 계획을 자동으로 새로 만든다 (직접 옮긴 배치는 과목이 그대로일 때만 유지)
  // 추천 시간표는 효율 순(Engine.rankedPlans)으로 1번부터. 「다른 버전」은 다음 순위.
  function ensurePlan() {
    if (state.plan && state.plan.takenSig === takenSig()) return;
    const list = E.rankedPlans(R, engineProfile(), state.taken);
    setPlan(list[0], 1, null, list.length);
  }
  function setPlan(p, version, seen, total) {
    state.plan = { semesters: p.semesters, unassigned: p.unassigned, neededCredits: p.neededCredits, capacity: p.capacity, takenSig: takenSig(),
      seed: p.seed || 0, version, total: total || 1, seen: [...(seen || []), E.pickKey(p)] };
    save();
  }
  // 다른 버전: 같은 학점(최소)으로 고른 과목이 다른 조합. 더 없으면 처음 추천으로 돌아간다.
  let planMsg = null;
  function nextPlanVersion() {
    ensurePlan();
    const cur = state.plan;
    const list = E.rankedPlans(R, engineProfile(), state.taken);
    const n = cur.version || 1;
    if (n < list.length) { setPlan(list[n], n + 1, cur.seen, list.length); planMsg = null; }
    else { setPlan(list[0], 1, null, list.length); planMsg = list.length > 1 ? `같은 학점으로 만들 수 있는 조합 ${list.length}가지를 모두 보여 드렸습니다. 가장 효율적인 1번으로 돌아왔습니다.` : '같은 학점으로 만들 수 있는 다른 조합이 없습니다.'; }
    renderPlan();
  }

  // 수강 계획 점검
  // terms: 남은 정규 학기 라벨 / capacity: 남은 학기 기본 한도 합(첫 학기는 이월·성적초과 반영, 혁신융합 제외)
  // semNote: 남은 필수 과목 중 한 학기에만 열리는데 남은 학기에 그 학기가 1번 이하인 과목
  // nonCredit: 학점 외 졸업 요건 중 아직 못 채운 것 / gen: 교양 세부(포털 시뮬레이션 기준)
  function planChecks(prof, need) {
    const terms = prof.remainingSemesters > 0 ? E.semesterLabels(prof.startTerm, prof.remainingSemesters) : [];
    let prev = E.currentLoad(R, prof, state.taken), capacity = 0;
    terms.forEach((t, i) => { capacity += E.semesterCap(R, prof, i, [], i === 0 ? prev : null).cap; });
    const leftOf = (id) => (need.credits.find((c) => c.id === id) || {}).left || 0;
    const totalLeft = Math.max(leftOf('TOTAL'), leftOf('MAJOR') + leftOf('BASE') + leftOf('GEN'));
    const semNote = {};
    for (const m of need.must) {
      if (m.offered.length !== 1) continue;
      const t = m.offered[0];
      const n = terms.filter((x) => Number(x.slice(-1)) === t).length;
      if (n === 0) semNote[m.id] = { level: 'error', text: `${t}학기에만 열리는데 남은 학기에 ${t}학기가 없습니다 — 학기를 늘려야 합니다` };
      else if (n === 1) semNote[m.id] = { level: 'warn', text: `${t}학기에만 열려 남은 기회가 ${terms.find((x) => Number(x.slice(-1)) === t)} 한 번입니다 — 놓치면 졸업이 늦어집니다` };
    }
    const nonCredit = need.evaluation.requirements.filter((r) => r.unit === '여부' && !r.satisfied).map((r) => r.name);
    const gen = E.genDetail(state.portal && state.portal.rows).filter((g) => g.left > 0 || g.subsLeft.length);
    const genReq = R.curricula[state.profile.curriculum].requirements.find((r) => r.kind === 'area' && r.area === 'gen');
    return { terms, capacity, totalLeft, short: Math.max(0, totalLeft - capacity), semNote, nonCredit, gen, genParts: genReq && genReq.parts,
      hasPortalGen: !!(state.portal && (state.portal.rows || []).some((r) => /^교양과정_/.test(r.name))) };
  }

  // 바꿔 들을 수 있는 과목 (Engine.alternatives). 대안이 많으면(전공 학점 채우기용) 목록 대신 한 줄로 줄인다.
  const ALT_LIST_MAX = 3;
  // 계획 과목이 왜 들어갔는지: must(필수 과목) / track(트랙 기준) / fill(영역 학점 채우기 — 「자유전공선택」 같은 기준 이름 대신 영역 이름)
  const FILL_LABEL = { major: '전공', base: '학과기초', gen: '교양', free: '자유선택', other: '타과' };
  function planReason(e) {
    const r = (e.reason || '').split(', ')[0];
    const cur = R.curricula[state.profile.curriculum];
    const req = cur && cur.requirements.find((x) => x.kind === 'allOf');
    if ((req && r === req.name) || r === '트랙 공통 필수') return { type: 'must', label: reqLabel(r) };
    if ((state.profile.tracks || []).some((id) => R.tracks[id] && r.startsWith(R.tracks[id].name))) return { type: 'track', label: r };
    const kind = e.custom ? e.area : E.resolveEntry({ id: e.id }, CAT, R).kind;
    return { type: 'fill', area: kind, label: `${FILL_LABEL[kind] || ''} 학점 채우기` };
  }
  function altText(e, alts) {
    const list = alts[e.id];
    if (!list) return null;
    if (list.length > ALT_LIST_MAX) return `같은 학기 다른 ${KIND_LABEL[E.resolveEntry({ id: e.id }, CAT, R).kind] || ''} 과목으로 바꿔도 됩니다 (${list.length}과목)`;
    return '또는 ' + list.map(courseName).join(' · ');
  }

  function moveItem(key, to) {
    const lists = [...state.plan.semesters.map((s) => s.items), state.plan.unassigned];
    let item = null;
    for (const list of lists) {
      const i = list.findIndex((e) => e.id === key);
      if (i >= 0) { item = list.splice(i, 1)[0]; break; }
    }
    if (!item) return;
    (to === 'unassigned' ? state.plan.unassigned : state.plan.semesters[Number(to)].items).push(item);
    save();
    renderPlan();
  }

  function renderPlan() {
    if (!ready()) return;
    ensurePlan();
    const plan = state.plan;
    const prof = engineProfile();
    const v = E.validatePlan(R, prof, state.taken, plan);
    const capOf = (where) => (where === 'unassigned' ? null : v.caps[Number(where)]);

    // 위: 졸업까지 남은 학점(영역별)과 아직 안 들은 필수 과목. 트랙을 골랐으면 트랙 기준별 남은 학점.
    const need = E.remainingNeeds(R, prof, state.taken);
    const left = (id) => { const c = need.credits.find((x) => x.id === id); return c ? c.left : 0; };
    const chk = planChecks(prof, need);
    // 앞으로 들을 학점 = 졸업 총학점 남은 것과 영역(전공·학과기초·교양) 남은 것의 합 중 큰 쪽.
    // 총학점은 넘었어도 전공이 모자라면 그만큼은 더 들어야 한다.
    const parts = [['MAJOR', '전공'], ['BASE', '학과기초'], ['GEN', '교양']].map(([id, label]) => [label, left(id)]).filter(([, n]) => n > 0);
    const areaLeft = parts.reduce((a, [, n]) => a + n, 0);
    const totalLeft = Math.max(left('TOTAL'), areaLeft);
    const freeLeft = totalLeft - areaLeft;
    $('plan-summary').replaceChildren(...[
      h('h3', { class: 'plan-total' }, '앞으로 들어야 할 학점 ', h('span', { class: 'plan-total-num' }, totalLeft ? `${totalLeft}학점` : '없음')),
      totalLeft ? h('p', { class: 'plan-breakdown' }, parts.map(([label, n]) => `${label} ${n}학점`).join(' · ') + (freeLeft ? `${parts.length ? ' · ' : ''}나머지 ${freeLeft}학점은 아무 과목(자유선택)` : '')) : null,
      // 남은 학기로 가능한지 (시간표를 만들기 전에 미리)
      chk.short ? h('div', { class: 'warning error' }, `남은 ${chk.terms.length}학기 동안 들을 수 있는 최대 학점은 ${chk.capacity}학점이라 ${chk.short}학점이 모자랍니다. `,
        h('button', { class: 'link', onclick: () => showTab('basic') }, '「기본 정보」에서 남은 학기 늘리기')) : null,
      // 학점 외 졸업 요건 한 줄
      h('p', { class: 'plan-noncredit' }, chk.nonCredit.length
        ? ['학점 외 졸업 요건: ', h('b', {}, chk.nonCredit.join(' · ')), ' 아직 — ', h('button', { class: 'link', onclick: () => { state.mode = 'grad'; save(); showTab('status'); } }, '「졸업 요건 확인」에서 체크')]
        : '학점 외 졸업 요건(졸업시험·공인외국어·사회봉사)은 모두 채웠습니다 ✓'),
    ,
      failedNotice(),
      overNotice(need.evaluation)].filter(Boolean));

    const tracksLeft = need.tracks.filter((t) => !t.satisfied);
    const nothing = !totalLeft && !need.must.length && !tracksLeft.length;
    $('plan-empty').hidden = !nothing;
    $('plan-empty').textContent = '더 들을 과목이 없습니다. 이번 학기 수강 중인 과목만 이수하면 학점·과목 기준을 모두 채웁니다.';
    const blocks = [
      h('h4', { class: 'need-sub' }, '꼭 들어야 할 과목 ', h('span', { class: 'meta' }, need.must.length ? `${need.must.length}과목 남음` : '모두 들었습니다')),
      need.must.length ? h('ul', { class: 'must-list' }, need.must.map((m) => h('li', {}, h('b', {}, m.name), h('span', { class: 'meta' }, ` ${m.credits}학점 · ${reqLabel(m.reason)}` + (m.offered.length ? ` · 표준 ${m.offered.join('·')}학기 개설` : '')),
        chk.semNote[m.id] ? h('div', { class: 'sem-note ' + chk.semNote[m.id].level }, '⚠ ' + chk.semNote[m.id].text) : null))) : null,
    ];
    // 교양 세부: 포털 시뮬레이션 기준. 없으면 기준만 안내
    if (chk.gen.length) {
      blocks.push(h('h4', { class: 'need-sub' }, '교양 세부 ', h('span', { class: 'meta' }, '— 자가진단 시뮬레이션 기준')),
        h('ul', { class: 'must-list' }, chk.gen.map((g) => h('li', {}, h('b', {}, `${g.label} ${g.left ? `${g.left}학점 남음` : ''}`), h('span', { class: 'meta' }, ` ${g.have}/${g.std}학점`),
          g.subsLeft.length ? h('span', { class: 'meta' }, ` · 아직: ${g.subsLeft.join(', ')}`) : null))));
    } else if (!chk.hasPortalGen && chk.genParts && left('GEN') > 0) {
      blocks.push(h('p', { class: 'hint' }, `교양은 ${chk.genParts}학점으로 나뉩니다. 영역별로 얼마나 남았는지는 자가진단 시뮬레이션 PDF를 넣으면 보입니다.`));
    }
    if (tracksLeft.length) {
      blocks.push(h('h4', { class: 'need-sub' }, '트랙 기준 채우기'));
      for (const t of tracksLeft) {
        blocks.push(h('ul', { class: 'must-list' }, t.parts.filter((x) => !x.satisfied).map((x) => h('li', {},
          h('b', {}, `${trackShort(t.id)} · ${x.label.split(' (')[0]} ${x.left}학점`),
          h('span', { class: 'meta' }, x.options.length ? ` — ${x.options.map(courseName).join(', ')} 중` : ' — 남은 과목 없음')))));
      }
    }
    $('need-list').replaceChildren(...(nothing ? [] : blocks.filter(Boolean)));
    $('need-title').hidden = true;

    // 추천 시간표: 눌러야 만든다. 「다른 버전」은 같은 학점으로 고른 과목이 다른 조합.
    const shown = state.planShown && !nothing;
    const noTrack = !prof.tracks.length;
    $('tt-bar').replaceChildren(...(nothing ? [] : shown
      ? [h('div', { class: 'tt-head' }, h('h3', {}, '추천 시간표 ', h('span', { class: 'count' }, `(추정) · ${(plan.version || 1) === 1 ? '가장 효율적인 안' : `${plan.version}순위`}${plan.total > 1 ? ` / ${plan.total}가지` : ''}`)),
          h('div', { class: 'tt-actions' },
            h('button', { class: 'tt-next', onclick: nextPlanVersion, title: '같은 학점으로 다른 과목 조합' }, '다른 버전 만들기'),
            h('button', { class: 'link', onclick: () => { state.planShown = false; planMsg = null; save(); renderPlan(); } }, '접기'))),
        noTrack ? h('p', { class: 'hint' }, '트랙을 하지 않으면 고를 수 있는 과목이 많습니다. 「다른 버전 만들기」로 같은 학점의 다른 조합을 볼 수 있습니다.') : null,
        planMsg ? h('div', { class: 'warning info' }, planMsg) : null]
      : [h('button', { class: 'tt-make', onclick: () => { state.planShown = true; save(); renderPlan(); } }, '추천 시간표 만들기'),
        h('span', { class: 'meta' }, ' 남은 학기에 최소 학점으로 배치해 봅니다')]).filter(Boolean));
    ['plan-warnings', 'sem-title', 'semesters'].forEach((id) => { $(id).hidden = !shown; });
    $('plan-warnings').replaceChildren(...v.warnings.filter((w) => w.level !== 'info').map((w) => h('div', { class: 'warning ' + w.level }, (w.level === 'error' ? '' : '⚠ ') + w.text)));
    if (!shown) return;

    const alts = E.alternatives(R, prof, state.taken, plan);

    const infoKeys = new Map(v.warnings.filter((w) => w.key).map((w) => [w.key, w.text]));
    const targets = [...plan.semesters.map((s, i) => [String(i), s.label]), ['unassigned', '미배정']];
    const chip = (e, where) => {
      const c = !e.custom && CAT[e.id];
      const name = c ? c.name : e.name;
      return h('div', { class: 'chip' + (infoKeys.has(e.id) ? ' flag' : ''), draggable: 'true', title: infoKeys.get(e.id) || '', ondragstart: (ev) => ev.dataTransfer.setData('text/plain', e.id) },
        h('div', {}, name, ` · ${E.entryCredits(e, CAT)}학점`, c ? h('span', { class: 'meta' }, ` ${c.module}`) : null),
        h('div', { class: 'why' }, [planReason(e).label, c && !c.offered.length ? '개설 학기 정보 없음' : c ? `표준 ${c.offered.join('·')}학기` : null].filter(Boolean).join(' · ')),
        altText(e, alts) ? h('div', { class: 'alt' }, altText(e, alts)) : null,
        h('select', { 'aria-label': `${name} 옮기기`, onchange: (ev) => moveItem(e.id, ev.target.value) },
          targets.map(([val, label]) => h('option', { value: val, selected: val === where }, val === where ? label : `→ ${label}`))));
    };
    const column = (title, items, where, extraClass) => {
      const load = items.reduce((a, e) => a + E.entryCredits(e, CAT), 0);
      const c = capOf(where);
      const col = h('div', { class: 'sem ' + (extraClass || '') + (c && load > c.cap ? ' over' : '') },
        // 가로 한 줄: 왼쪽 학기·학점, 오른쪽에 과목 카드들
        h('div', { class: 'sem-side' },
          h('div', { class: 'sem-head' }, h('span', {}, title), h('span', { class: 'cr', title: c && c.parts.length ? `기본 ${c.base} + ` + c.parts.map((x) => `${x.label} ${x.credits}`).join(' + ') : '' },
            c ? `${load} / ${c.cap}학점` : `${load}학점`)),
          c && c.parts.length ? h('div', { class: 'hint' }, c.parts.map((x) => `${x.label} +${x.credits}`).join(' · ')) : null),
        h('div', { class: 'sem-items' }, items.map((e) => chip(e, where)),
          items.length ? null : h('div', { class: 'hint' }, where === 'unassigned' ? '학기에 넣지 못했거나 뺀 과목' : '배정된 과목 없음')));
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('dragover'); });
      col.addEventListener('dragleave', () => col.classList.remove('dragover'));
      col.addEventListener('drop', (ev) => { ev.preventDefault(); col.classList.remove('dragover'); moveItem(ev.dataTransfer.getData('text/plain'), where); });
      return col;
    };
    // 미배정 칸은 학기에 넣지 못한(또는 직접 뺀) 과목이 있을 때만 생긴다
    const cols = plan.semesters.map((s, i) => column(s.label, s.items, String(i)));
    if (plan.unassigned.length) cols.push(column('미배정', plan.unassigned, 'unassigned', 'unassigned'));
    $('semesters').replaceChildren(...cols);
  }

  // (계획서 내보내기는 2026-11-08 없앴다)
  const KIND_LABEL = { major: '전공', base: '학과기초', gen: '교양', free: '자유선택', other: '타과(트랙)' };

  // ───────── 탭 ─────────
  let currentTab = 'home';
  // 처음 열면 늘 목적 고르기부터. 같은 탭에서 새로고침했을 때만 보던 화면을 유지한다.
  try { currentTab = sessionStorage.getItem('gradcheck.tab') || 'home'; } catch (e) { /* 무시 */ }

  function showTab(tab) {
    if (tab === 'track') tab = 'courses'; // 예전 「트랙」 단계는 「과목·트랙」에 합쳤다
    if (tab === 'doc') tab = 'home'; // 예전 「자료 첨부」 단계는 처음 화면에 합쳤다
    // PDF 전 → 처음, PDF 후 목적 전 → 목적 고르기
    if (tab !== 'home' && tab !== 'purpose' && !state.mode) tab = baseReady() ? 'purpose' : 'home';
    else if (tab === 'result' || tab === 'status' || tab === 'plan') tab = MODES[state.mode].result;
    if (!tabAllowed(tab)) tab = !baseReady() ? 'home' : ['status', 'plan'].includes(tab) ? 'courses' : 'home'; // PDF 전 → 처음, 트랙 여부 전 → 과목·트랙
    currentTab = tab;
    try { sessionStorage.setItem('gradcheck.tab', tab); } catch (e) { /* 무시 */ }
    document.querySelectorAll('.steps button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + tab; });
    window.scrollTo && window.scrollTo(0, 0);
    render();
  }

  function render() {
    const needBasic = !ready() && ['status', 'plan'].includes(currentTab);
    $('need-basic').hidden = !needBasic;
    const home = currentTab === 'home' || currentTab === 'purpose';
    $('mode-bar').hidden = !state.mode || home;
    if (state.mode) {
      $('mode-name').textContent = MODES[state.mode].name;
      document.querySelectorAll('[data-mode-opt]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.modeOpt === state.mode)); b.classList.toggle('on', b.dataset.modeOpt === state.mode); });
      $('track-next').textContent = state.mode === 'plan' ? '다음: 수강 계획 →' : '다음: 졸업 현황 →';
    }
    $('stepbar').hidden = !state.mode || home;
    const steps = [...document.querySelectorAll('.steps button')];
    const curIdx = steps.filter((b) => tabInMode(b.dataset.tab)).findIndex((b) => b.dataset.tab === currentTab);
    let n = 0;
    steps.forEach((b) => {
      b.hidden = !tabInMode(b.dataset.tab);
      if (b.hidden) return;
      const i = n++;
      b.replaceChildren(h('span', { class: 'step-num' }, i < curIdx ? '✓' : String(i + 1)), h('span', { class: 'step-label' }, b.dataset.label));
      b.classList.toggle('done', i < curIdx);
      b.disabled = !tabAllowed(b.dataset.tab);
    });
    if (currentTab === 'home') renderDoc();
    if (currentTab === 'purpose') renderPurpose();
    if (currentTab === 'basic') renderBasic();
    if (currentTab === 'courses') renderCourses();
    if (currentTab === 'status') renderStatus();
    if (currentTab === 'plan') renderPlan();
  }

  function init() {
    $('boot-note').hidden = true; // 시작됨 — 「새로고침해 주세요」 안내 숨김
    $('dept').textContent = `${R.departmentShort} · ${R.handbook.year}학년도 기준`;
    $('sample-banner').hidden = !R.sampleData;
    document.querySelectorAll('.steps button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
    // 목적 고르기·바꾸기. 바꿔도 입력한 자료·과목은 그대로 두고, 이미 준비됐으면 바로 결과 탭으로 간다.
    // 처음 화면에서 목적을 고르면 기본 정보 확인부터. 위쪽 목적 메뉴로 바꾸면 결과 화면으로 바로.
    const pickMode = (m, fromHome) => { state.mode = m; save(); showTab(!baseReady() ? 'home' : fromHome || !ready() ? 'basic' : 'result'); };
    document.querySelectorAll('[data-mode-pick]').forEach((b) => b.addEventListener('click', () => pickMode(b.dataset.modePick, true)));
    document.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => pickMode(b.dataset.switch)));
    // 위쪽 목적 칩: ▾ 를 누르면 두 목적 중 고른다 (입력한 내용은 그대로)
    const modeMenu = $('mode-menu'), modeToggle = $('mode-toggle');
    const setMenu = (open) => { modeMenu.hidden = !open; modeToggle.setAttribute('aria-expanded', String(open)); };
    modeToggle.addEventListener('click', (e) => { e.stopPropagation(); setMenu(modeMenu.hidden); });
    document.querySelectorAll('[data-mode-opt]').forEach((b) => b.addEventListener('click', () => { setMenu(false); if (b.dataset.modeOpt !== state.mode) pickMode(b.dataset.modeOpt); }));
    document.addEventListener('click', (e) => { if (!modeMenu.hidden && !modeMenu.contains(e.target)) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    document.addEventListener('click', (e) => document.querySelectorAll('details.tip[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
    bindCourseInputs();
    bindDocInput();
    const backup = () => {
      // 창을 닫으면 지워지므로, 이어서 쓰려면 이 파일을 저장한다. 불러온 시뮬레이션 결과(이름·학번 없음)도 같이 담는다.
      const blob = new Blob([JSON.stringify({ profile: state.profile, taken: state.taken, mode: state.mode, portal: state.portal, simCourses: state.simCourses, planShown: state.planShown }, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'graduation-check-backup.json' });
      a.click();
      URL.revokeObjectURL(a.href);
    };
    $('export-btn').addEventListener('click', backup);
    // 백업 불러오기 (처음 화면·기본 정보 두 곳)
    document.querySelectorAll('.import-file').forEach((input) => input.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()), d = defaults();
        state = { ...d, mode: data.mode || state.mode, profile: { ...d.profile, ...data.profile, maxCredits: d.profile.maxCredits, extra: { ...d.profile.extra, ...(data.profile || {}).extra } },
          taken: data.taken || [], plan: null, handbook: state.handbook, trackDoc: state.trackDoc,
          portal: data.portal || state.portal, simCourses: data.simCourses || state.simCourses, planShown: !!data.planShown };
        save();
        if (!state.portal) alert('이 백업에는 시뮬레이션 결과가 없습니다. 자가진단 시뮬레이션 PDF를 넣어 주세요.');
        showTab(state.portal && state.mode ? 'basic' : 'home');
      } catch (err) { alert('백업 파일을 읽지 못했습니다.'); }
      e.target.value = '';
    }));
    // 새로 시작: 묻지 않고 이 브라우저에 저장된 내용을 모두 지우고 처음(목적 고르기)부터.
    // 페이지를 다시 불러와 화면 코드도 최신으로 맞춘다.
    const resetAll = () => {
      state = defaults();
      save();
      try { sessionStorage.removeItem('gradcheck.tab'); } catch (e) { /* 무시 */ }
      location.reload();
    };
    $('reset-open').addEventListener('click', resetAll);
    // 예전 버전 저장분: 기준 학기를 골라 둔 상태면 현재 기준으로 되돌리고, 입학년도가 없으면 시뮬레이션 기준년도로 채운다
    if (state.profile.asOf) { state.profile.asOf = null; rebuildTaken(); save(); }
    if (!state.profile.entryYear && state.portal && state.portal.baseYear && state.profile.studentType === 'regular') { state.profile.entryYear = state.portal.baseYear; save(); }
    showTab(currentTab);
  }

  init();
})();
