// 성공 기준 검증: 동의받은 편입생의 실제 이수 내역을 판정해 학과(학사팀) 졸업사정 결과와 비교한다.
// 사용법: node scripts/validate.js [cases 폴더]   (기본: cases/)
// expected는 판정 모드별로 적는다: now(포털 현재 기준), predict(이번 학기 후 예측), plan
//   credits: { 요건ID: 학점 }  requirements: { 요건ID: 충족여부 }  tracks: { 트랙ID: 충족여부 }  graduationEligible
// 실제 학생 파일은 저장소에 올리지 말 것(.gitignore).
const fs = require('fs');
const path = require('path');
const R = require('../rules.js');
const E = require('../engine.js');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'cases'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (!files.length) { console.error(`케이스 파일 없음: ${dir}`); process.exit(2); }

let pass = 0;
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const diffs = [];
  for (const [mode, exp] of Object.entries(c.expected || {})) {
    const ev = E.evaluate(R, c.profile, c.taken, mode);
    const req = (id) => ev.requirements.find((x) => x.id === id);
    for (const [id, want] of Object.entries(exp.credits || {})) {
      const r = req(id);
      if (!r) diffs.push(`[${mode}] 요건 ${id}: 도구에 없는 요건`);
      else if (r.earned !== want) diffs.push(`[${mode}] ${r.name} 학점: 도구 ${r.earned} / 학과 ${want}`);
    }
    for (const [id, want] of Object.entries(exp.requirements || {})) {
      const r = req(id);
      if (!r) diffs.push(`[${mode}] 요건 ${id}: 도구에 없는 요건`);
      else if (r.satisfied !== want) diffs.push(`[${mode}] ${r.name}: 도구 ${r.satisfied ? '충족' : '부족'} / 학과 ${want ? '충족' : '부족'}`);
    }
    for (const [id, want] of Object.entries(exp.tracks || {})) {
      const t = ev.tracks.find((x) => x.id === id);
      if (!t || t.satisfied !== want) diffs.push(`[${mode}] 트랙 ${id}: 도구 ${t ? t.satisfied : '없음'} / 학과 ${want}`);
    }
    if (exp.graduationEligible !== undefined && exp.graduationEligible !== ev.allSatisfied) {
      diffs.push(`[${mode}] 졸업 가능: 도구 ${ev.allSatisfied} / 학과 ${exp.graduationEligible}`);
    }
  }
  if (diffs.length) {
    console.log(`✗ ${f} (${c.label || ''})`);
    for (const d of diffs) console.log('    ' + d);
  } else {
    pass++;
    console.log(`✓ ${f} (${c.label || ''})`);
  }
}
console.log(`\n${pass} / ${files.length} 일치`);
process.exit(pass === files.length ? 0 : 1);
