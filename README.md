# 금리·물가 알리미 (PWA)

한국·미국의 **기준금리**와 **소비자물가 상승률**을 한눈에 보고, 발표 당일 알림을 받는 설치형 웹앱입니다.

## 기능

- **국가별 파트 구성** — 한국 파트(기준금리+물가), 미국 파트(기준금리+물가)로 나뉘어 각 파트에 현재 지표 카드, 5년 추이 차트, 12개월 전망이 함께 표시
- **발표 일정 + 알림** — 금통위·FOMC·통계청/BLS 물가 발표일 D-day 목록, 발표 당일 푸시 알림(권한 허용 시), 발표일 상단 배너
- **5년 추이 차트** — 2021년 7월~현재, 기간 필터(1/3/5년), 크로스헤어 툴팁, 다크 모드
- **12개월 전망** — 물가는 "2% 목표로의 수렴" 통계 모형, 금리는 물가 전망 연동 규칙 기반 시나리오로 자동 계산 (점선 표시)
- **수동 업데이트** — 새 발표값을 입력하면 카드·차트·전망이 즉시 재계산되어 기기에 저장(localStorage)
- **PWA** — 홈 화면 설치, 오프라인 동작(서비스워커 캐시)

## 실행 방법

서비스워커·알림은 `file://`로 열면 동작하지 않으므로 로컬 서버로 실행하세요.

```
cd "C:\Users\User\Documents\금리&물가상승률 알리미"
python -m http.server 8765
```

브라우저에서 `http://localhost:8765` 접속 → 주소창의 설치 아이콘(또는 앱의 "설치" 버튼)으로 홈 화면에 추가.

배포하려면 GitHub Pages / Cloudflare Pages / Netlify / Vercel 등 아무 정적 호스팅에 폴더 그대로 올리면 됩니다(HTTPS 필수).

## Cloudflare Pages로 배포 (GitHub 연동)

GitHub 저장소를 Cloudflare Pages에 연결하면, 이후 봇이 데이터를 커밋할 때마다 자동으로 재배포됩니다.

1. https://dash.cloudflare.com 로그인 (계정이 없으면 무료 가입)
2. 왼쪽 메뉴 **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git**
3. GitHub 계정 인증 후 저장소 **`rate-inflation-alert`** 선택
4. 빌드 설정 (정적 사이트라 빌드 없음):
   - **Framework preset**: `None`
   - **Build command**: (비워둠)
   - **Build output directory**: `/`  (루트)
   - **Production branch**: `master`
5. **Save and Deploy** → 잠시 후 `https://rate-inflation-alert.pages.dev` 형태의 주소가 생성됩니다.

빌드 단계가 없으므로 GitHub Actions가 `series.js`를 커밋하면 Cloudflare가 그 파일을 그대로 다시 배포합니다.
`_headers` 파일이 서비스워커·데이터 파일의 과도한 캐시를 막아, 갱신 후 옛 버전이 남지 않게 합니다.

## 데이터 파일 구조

데이터는 두 파일로 분리되어 있습니다.

- [series.js](series.js) — **자동 생성**. 기준금리·물가상승률 수치. `scripts/fetch_data.py`가 덮어씁니다. 손으로 고치지 마세요.
- [schedule.js](schedule.js) — **수동 관리**. 발표 일정. 한국은행·연준이 다음 해 회의 일정을 보통 12월에 발표하면 그때 새 날짜를 추가하세요.

## 업데이트 방법 3가지

### 1. 완전 자동 (GitHub Actions) — 권장

`.github/workflows/update-data.yml`이 하루 3번(한국 발표 시간대, 미국 CPI 시간대, FOMC 시간대) `scripts/fetch_data.py`를 실행해
한국은행 ECOS API·미 FRED API에서 최신 수치를 받아 `series.js`를 자동 커밋합니다. 값이 실제로 바뀐 날에만 커밋됩니다.

**설정에 필요한 것 (아래 "GitHub 배포" 절 참고):**
- 한국은행 ECOS API 키, 미 FRED API 키 (둘 다 무료, 본인이 직접 발급)
- GitHub 저장소 + Actions Secrets에 두 키 등록
- GitHub Pages 활성화

물가상승률(YoY %)은 API가 주는 "등락률" 값을 그대로 믿지 않고, 지수값을 받아
`(당월 지수 / 전년동월 지수 - 1) × 100` 공식으로 스크립트가 직접 계산합니다 — 통계청·BLS가 발표하는 정의와 동일합니다.

### 2. 앱에서 직접 입력

자동화를 설정하지 않았거나 자동 수집이 실패했을 때의 보완 수단입니다.
발표 당일 알림을 받은 뒤 "새 발표값 입력" 폼에 수치를 넣으면 즉시 반영되고 이 기기에 저장됩니다.

### 3. series.js 수동 수정

`rateKR`/`rateUS`는 `["YYYY-MM", 값]`을 배열 끝에 추가, `cpiKR`/`cpiUS`는 2021-07부터 이어지는 월별 배열 끝에 값을 추가하면 됩니다.

## GitHub Actions + Pages로 완전 자동화하기

1. **API 키 발급 (본인이 직접)**
   - 한국은행 ECOS: https://ecos.bok.or.kr → 회원가입 → Open API 인증키 신청 (보통 1일 내 발급)
   - 미 FRED: https://fred.stlouisfed.org/docs/api/api_key.html → 계정 생성 → API Key 발급 (즉시 발급)
2. **GitHub 저장소 생성 & 이 폴더 푸시**
3. **저장소 Secrets 등록** — Settings → Secrets and variables → Actions → New repository secret
   - `ECOS_API_KEY` = 위에서 받은 한국은행 키
   - `FRED_API_KEY` = 위에서 받은 FRED 키
   - (API 키는 반드시 GitHub 화면에서 직접 입력하세요. 다른 사람·도구에게 값을 알려주지 마세요.)
4. **GitHub Pages 활성화** — Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)`
5. **동작 확인** — Actions 탭 → "금리·물가 데이터 자동 갱신" → `Run workflow`로 수동 실행 후 로그 확인. 이후에는 스케줄대로 자동 실행됩니다.

## 알림의 한계 (정적 PWA)

이 앱은 백엔드 서버 없이 정적 파일로 동작하므로 완전한 백그라운드 푸시는 불가능합니다.
- 앱(또는 설치된 PWA)을 여는 순간 발표일을 확인해 알림/배너 표시
- Periodic Background Sync를 지원하는 환경(Android Chrome 설치형)에서는 앱을 열지 않아도 하루 2회 점검 후 알림
- GitHub Actions 자동화는 **데이터**를 최신으로 유지해줄 뿐, 기기로 푸시를 강제로 보내지는 못합니다(정적 사이트의 구조적 한계). 발표 당일 알림은 여전히 앱이 열려 있거나 Periodic Sync가 동작할 때 옵니다.

## 데이터 출처

한국은행 기준금리 · 통계청 소비자물가동향 · 미 연준 FOMC · 미 노동통계국(BLS) CPI.
내장 데이터 기준일: **2026-07-20** (미국 2025년 10~11월 CPI는 연방정부 셧다운으로 미발표 결측).

모든 수치와 전망은 정보 제공 목적이며 투자 자문이 아닙니다.
