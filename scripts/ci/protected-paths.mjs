// 보호 대상 경로 단일 목록(Lee 승인 필요 경로 — 결정 0003, 2026-11-15 S4 개정).
// 여기 한 곳만 고치면 세 곳이 함께 움직인다: ① scripts/decision-approval-gate.mjs의 GATE_CODE(Actions 승인 판정·claude-publish 금지 경로),
// ② scripts/check-approval-scope.mjs(.github/CODEOWNERS가 이 목록과 정확히 같은지 검사), ③ 시험(scripts/check-approval-scope.test.mjs).
// 같은 목록을 정규식·CODEOWNERS·허용표에 따로 적지 않는다 — 따로 적으면 서로 어긋난다(검토 지적).
// 이 파일 자체가 /scripts/ci/ 아래라 Lee 승인 대상이다.
export const OWNER_HANDLE = '@KHOAILANG0926'
export const DECISION_DIR = '/docs/decisions/'
// 엔진 정리 1차(Lee 2026-11-22 중간안): Lee 승인은 '권한·보안(RLS·인증)·비밀키·DB 데이터 삭제·화면 모양'과 그것을 지키는 승인 장치 자체에만 남긴다.
// 검사 스크립트·일반 워크플로·자동 작업 설정·일반 코드는 승인 없이 기본 검사 통과 뒤 자동 병합한다.
// 승인 장치 자체(승인 판정·보호 목록·병합 실행기·Claude 게시 검증·비밀값 격리 검사·migration 허용표·검토 기준)를 남기는 이유: 이것을 승인 없이 바꿀 수 있으면
// 위 다섯 가지 승인 요구를 PR 하나로 끌 수 있다. 일반 워크플로의 열쇠·쓰기 권한·실행 환경 줄은 승인 판정 ⑦(바뀐 줄 내용)이 따로 잡는다.
export const OWNER_PATHS = [
  DECISION_DIR,
  '/.github/CODEOWNERS',
  '/.github/approved-migrations.json',
  '/.github/workflows/approval-checks.yml',
  '/.github/workflows/review-signal.yml',
  '/.github/workflows/bot-pr-automerge.yml',
  '/.github/workflows/migrations-apply.yml',
  '/.github/workflows/ops-run-sql.yml',
  '/scripts/ci/protected-paths.mjs',
  '/scripts/ci/approval-checks.mjs',
  '/scripts/ci/claude-publish.mjs',
  '/scripts/ci/check-secret-isolation.py',
  '/scripts/decision-approval-gate.mjs',
  '/scripts/check-approval-scope.mjs',
  '/scripts/approved-migrations.mjs',
  '/AGENTS.md',
]
// Claude 게시 잡이 고칠 수 없는 곳(S4 격리, #822): 승인 범위를 줄여도 이 목록은 그대로다 — Lee 승인 없이 병합되는 사람 PR과 달리
// Claude가 도는 잡의 산출물은 검증 게시 단계가 이 목록으로 막는다. (예전 Lee 승인 목록 그대로)
export const AI_LOCKED_PATHS = [
  DECISION_DIR,
  '/.github/',
  '/scripts/ci/',
  '/scripts/status/',
  '/scripts/check-*.mjs',
  '/scripts/*-gate.mjs',
  '/scripts/approved-migrations.mjs',
  '/AGENTS.md',
]

// CODEOWNERS 모양의 단순 패턴: '/폴더/'는 그 아래 전부, '*'는 한 칸(슬래시 없이 1글자 이상), 그 밖은 정확히 같은 파일.
export function matchesOwnerPath(path, list = OWNER_PATHS) {
  return list.some((p) => {
    const g = p.slice(1)
    if (g.endsWith('/')) return path.startsWith(g)
    const [pre, suf] = g.split('*')
    if (suf === undefined) return path === g
    const mid = path.slice(pre.length, path.length - suf.length)
    return path.length > pre.length + suf.length && path.startsWith(pre) && path.endsWith(suf) && !mid.includes('/')
  })
}
