# 공개 판정 단일화 설계 (Draft, 설계만 — 코드·SQL·트리거 수정 없음)

- 요청: Lee 2026-11-22 (엔진 정리 1차 후속). 이 문서는 설계다. 어떤 migration·트리거·함수도 이 PR에서 바꾸지 않는다.
- 병합 조건: Lee 승인 전 병합 금지(Draft 유지). 실제 구현은 설계 확정 뒤 별도 PR(STRICT, migration + production_check).
- 근거 표시: [직접 확인] = 이 저장소 파일을 읽음 / [추정] / [확인 못 함].

## 1. 우선순위(위가 이김)
1. 기존 공개 공고 보호: 이 작업 때문에 지금 공개인 공고가 비공개로 바뀌면 즉시 중단.
2. 비공개 사유 보존: 여러 원인을 한 칸이 덮어쓰지 않는다.
3. 기존 기능 유지: `ingest_job`(입구), 위치 검증, 직업분류, 중복 차단. 합치는 것은 "같은 판정을 두 번 하는 경로"뿐.

## 2. 현재 구조 [직접 확인: supabase/migrations]
`local_jobs` BEFORE INSERT/UPDATE 트리거는 이름순(C 정렬)으로 돈다. 공개 여부(active)를 바꾸거나 막는 것만 적는다.

| 순서 | 트리거 → 함수 | 하는 일 | 사유 기록 위치 |
|---|---|---|---|
| 1 | trg_000_ingest_gateway_only(INSERT) | 입구 아닌 직접 등록 차단 | 예외 |
| 2 | trg_00_occupation_category → sync_occupation_category | category = category_for_job(code, ocr_check) | category |
| 3 | trg_enforce_job_posting_policy → enforce_job_posting_policy | 정책 판정; exclude는 저장 거부, review는 active=false | policy_decision |
| 4 | trg_zz0_publish_gate → enforce_job_publish_gate | 위치·연락처; crawler만 not ok이면 active=false | publish_gate_reason |
| 5 | trg_zz_enforce_job_posting_rules → enforce_job_posting_rules | R1~R7(전화 숫자·정책 재계산·원문·회사/연락처 보존·연령·이미지 있으면 OCR ok 전까지 active=false) | policy_decision, 예외 |
| 6 | trg_zzz_inspect_current → enforce_job_inspect_current | 공개 시작 시 검사 통과 기록(content_hash+publishable) 없으면 active=false | ocr_check.inspect_hold |
| 7 | trg_zzz_local_jobs_occupation_r8 → local_jobs_occupation_r8 | 코드·근거 검증, 근거 사라지면 code=null | occupation_code |
| 8 | trg_zzzy_occupation_category | 7이 코드를 비운 뒤 category 재계산 | category |
| 9 | trg_zzzz_occupation_publication → enforce_occupation_publication | job_occupation_publish_reason ≠ ok이면 active=false | (없음: 코드 null 자체가 사유) |
| 10 | trg_zzzzz_duplicate_hold → dedupe_private.hold_on_publish | 비공개→공개 때 duplicate 판정; suspect/duplicate는 active=false | duplicate_status/of/reason |

- 위치 때문에 숨긴 공고는 별도 표 `map_r1_unlocated(prev_active, reason)`에 보존된다. 예전 `trg_map_r1_block_unlocated`는 20261028160000에서 삭제됨(지금은 공개를 막지 않음).
- 관리자 숨김은 `admin_hidden`(트리거 아님, 입구·정책 모두 이 값이면 공개 변경 안 함).
- 입구: `ingest_job`은 판정 칸을 받지 않고(origin·admin_hidden·policy_decision·ocr_* 제외) 저장한 뒤 `ingest_private.job_state`로 사유를 `coalesce(publish_gate_reason, policy_decision)` **한 개만** 기록한다. 검사 보류·중복·직업분류 미확정은 입구 로그의 사유에 안 나온다(= 현재도 사유가 합쳐져 사라지는 곳).
- 공개 여부 쓰기 경로: 크롤러(job_quality, crawl_topcv), OCR(scripts/ocr/ocr-check*.mjs), 검사기(job-inspect-write, jobInspect.ts), 관리자(adminOperations.ts), 고용주(jobRows.ts), 운영 스크립트(ops-publish-jobs.yml) 등 [직접 확인: grep]. 모두 위 트리거를 거친다.

## 3. 중복 경로 판정
- 정책 판정 이중: 3과 5가 같은 job_policy_decision을 계산. 5는 항상 덮어씀, 3은 거부/비공개를 담당. 재평가 조건도 서로 다름(3: 공개 행이 내용 안 바뀌면 건너뜀 / 5: 근거 칸 변경 또는 새로 공개될 때). → 통합 후보 A.
- 직업코드 이중: 7(검증·코드 비움)과 9(비공개). 판정 함수는 이미 하나(job_occupation_publish_reason)이고 트리거만 둘. 단 7→8→9 순서가 보존돼야 함. → 통합 후보 B.
- 업종(2·8) 이중: 합치지 않는다. 2는 정책 판정(3·5)이 category를 읽기 전에 필요, 8은 7이 코드를 비운 뒤 필요. 로컬 시험으로 확인: 8만 지우면 "근거 사라진 공고에 옛 category가 남음" 실패.
- 합치지 않는 것: 4(위치·연락처), 6(검사 기록), 10(중복) — 판정 근거가 서로 다르다.

## 4. 설계
### 4-1. 비공개 사유는 "한 칸"이 아니라 "사유별 기록"
- 단일 사유 칸 하나를 두지 않는다(덮어쓰기 위험). 대신 사유 종류별로 이미 있는 원본 칸을 그대로 두고, 읽기용 **합집합 뷰** `job_hide_reasons_v(job_id, kind, code, since)`를 둔다.
- kind: location(map_r1_unlocated·publish_gate_reason=no_address_text) / contact(no_application_path) / policy(policy_decision review·exclude) / category·occupation(job_occupation_publish_reason ≠ ok) / inspect(ocr_check.inspect_hold) / ocr(ocr_check.status≠ok, 이미지 있음) / duplicate(duplicate_status suspect·duplicate) / expired(마감) / admin(admin_hidden).
- 한 공고가 여러 kind에 동시에 걸리면 모두 나온다. 첫 번째 것만 보이거나 마지막이 덮어쓰지 않는다. 원본 칸은 바꾸지 않으므로 기존 동작·검사표·화면이 그대로다.
- 1단계는 뷰만 추가(새 칸·트리거 변경 없음). 뷰가 현재 모든 공개/비공개 행을 설명하는지 읽기 전용으로 검증.
- `ingest_job` 로그의 사유는 뷰를 읽어 모든 kind를 남기도록 고친다(후속, 로그만).

### 4-2. 판정 한 곳
- 새 읽기 전용 함수 `job_publish_decision(row)` → (allowed, kinds[]). 안에서 기존 판정 함수(job_publish_gate_reason, job_occupation_publish_reason, job_policy_decision, job_inspect_content_hash, dedupe_private.verdict)를 **호출만** 한다. 판정 로직 자체는 복사하지 않는다.
- 트리거는 단계적으로 줄인다: A(3+5 정책) → B(7+9 직업). 매 단계 "같은 입력 → 같은 active·같은 저장 칸" 동등성 시험을 통과해야 다음으로.

### 4-3. 단계
1. 뷰 + 섀도 비교(읽기 전용): 현재 모든 행에서 뷰 결과와 실제 공개 상태가 일치하는지.
2. 후보 A 통합. 3의 예외(exclude 거부)를 5로 옮기고 3 삭제. 재평가 조건 차이는 "더 자주 재평가하지 않는다"로 맞춤(공개 행 보호).
3. 후보 B 통합. R8→업종→공개판정 순서 불변.
4. 입구 로그가 뷰를 읽음.
- 각 단계는 독립 PR, 되돌리는 SQL(rollback)을 같이 낸다.

## 5. 공개 공고 보호 장치
- 구현 PR마다: (가) 병합 전 공개 공고 스냅샷(id 집합·내용·위치 점)을 서버 비공개 저장소에 기록 (나) 병합·적용 후 같은 조회로 비교 — id 집합과 내용이 같아야 통과, 숫자만 같아서는 통과 아님 (다) 공개→비공개 전환이 하나라도 있으면 즉시 중단·원인 보고.
- 트리거 변경은 "공개 행이 내용 변경 없는 UPDATE를 받으면 active 유지" 시험 필수(현재 3의 재평가 건너뜀 동작을 보존).
- 전체 재처리(refresh-facebook-existing) 미실행 확인: Actions 실행 이벤트 + job_reprocess_queue 변동.

## 6. 영향 범위
- 시험(supabase/tests, pglite): job_duplicate_check, job_posting_rules, lee_source, local_jobs_occupation_r8, occupation_category, occupation_publication, ocr_inspect_republish — 마이그레이션 파일을 직접 읽으므로 트리거 이름·순서에 의존 [직접 확인: grep].
- 운영 검사 SQL(*_production_check.sql): 트리거 이름·개수를 직접 확인하는 곳 — db_publish_gate, job_inspect_content_hash, inspect_gate_employer_legacy, job_duplicate_check, occupation_publication, occupation_category(트리거 2개 존재 확인), r8_any_level_restore, map_r1_preflight_assertions, local_jobs_occupation_r8_check. 트리거를 지우는 단계는 이 검사들을 같은 PR에서 고쳐야 한다.
- 문서: CLAUDE.md·AGENTS.md가 trg_zzzz_occupation_publication·R8을 강제 장치로 언급 → 같은 PR에서 갱신.
- 수집·입구: `ingest_job`·crawler·ops-publish-jobs.yml은 트리거를 거치기만 하므로 동작 변화 없어야 함(동등성 시험으로 확인).
- [확인 못 함] `ingest_job`의 최신 정의가 20261029010000 이후 다시 바뀌었는지, 마이그레이션 밖(Supabase 콘솔)에서 만든 트리거가 없는지, 운영 DB의 실제 트리거 목록(운영 직접 조회 금지) — 구현 전 읽기 전용 운영 검사로 확인해야 한다.

## 7. 위험
- 순서 의존: 트리거 이름순이 곧 논리 순서. 합치면 순서가 바뀌어 결과가 달라질 수 있음 → 동등성 시험.
- 공개 공고 회귀: 재평가가 더 자주 일어나면 공개 행이 비공개로 바뀔 수 있음 → 3의 "내용 안 바뀌면 건너뜀" 보존.
- 사유 유실: 단일 칸 방식은 채택하지 않음(4-1).
- STRICT: 트리거 삭제·뷰 추가는 DB 구조 변경이므로 Lee 별도 승인 + dry-run 보고 후에만.

## 8. 하지 않는 것
- `ingest_job`·위치·직업분류·중복 차단의 판정 로직 변경, 새 판정 규칙 추가, 공고 번호·이름 예외, 운영 DB 직접 접근.
