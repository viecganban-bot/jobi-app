// 읽기 전용 공개 공고 스냅샷(Lee 2026-11-22, 엔진 정리 1차 병합 전후 비교용). 쓰기·비밀키·개인정보 없음.
// 앱이 공개로 내보내는 것과 같은 앱 공개 키(anon, RLS)로 공개 공고만 읽는다 — location-administrative-public-check.mjs와 같은 읽기 방식.
// 담는 칸: 공고 id·제목·회사·위치 글자·공개 상태(active, admin_hidden)·등록·게시 시각(created_at·posted_at — updated_at은 공개 키로 읽을 수 없는 칸이라 제외), 근무지 원본 점(id·좌표·정확도). 연락처·원문·계정 정보는 읽지 않는다.
import {writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {supabaseServer as client} from '../../src/lib/supabaseServer.ts'
const out = process.argv[2] || 'public-jobs-snapshot.json'
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
try {
  const at = new Date().toISOString(), jobs = []
  for (let from = 0; ; from += 500) {
    const {data, error} = await client.from('local_jobs').select('id,title,company,location,lat,lng,active,admin_hidden,created_at,posted_at')
      .eq('active', true).eq('admin_hidden', false).order('id').range(from, from + 499).abortSignal(AbortSignal.timeout(20000))
    if (error) throw new Error('public_jobs_unavailable: ' + error.message)
    jobs.push(...data)
    if (data.length < 500) break
  }
  if (!jobs.length) throw new Error('public_jobs_empty')
  const points = []
  for (let i = 0; i < jobs.length; i += 100) {
    const {data, error} = await client.from('job_work_locations').select('id,job_id,raw_address,lat,lng,point_kind,point_precision,location_verified')
      .in('job_id', jobs.slice(i, i + 100).map((j) => j.id)).order('id').abortSignal(AbortSignal.timeout(20000))
    if (error) throw new Error('public_source_points_unavailable: ' + error.message)
    points.push(...data)
  }
  const ids = jobs.map((j) => j.id)
  const meta = {kind: 'read-only-public-jobs-snapshot', at, commit: process.env.GITHUB_SHA ?? null, count: jobs.length, pointRows: points.length, idsSha256: sha(ids), jobsSha256: sha(jobs), pointsSha256: sha(points)}
  writeFileSync(out, JSON.stringify({...meta, ids, jobs, points}, null, 1))
  console.log(JSON.stringify(meta))
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### 공개 공고 스냅샷 (읽기 전용)\n- 기준 시각: ${at}\n- 공개 공고 수: ${jobs.length} / 근무지 점 ${points.length}\n- id 목록 sha256: \`${meta.idsSha256}\`\n- id: ${ids.join(', ')}\n`, {flag: 'a'})
} catch (error) {
  console.log(JSON.stringify({kind: 'read-only-public-jobs-snapshot', verified: false, error: error.message}))
  process.exitCode = 1
}
