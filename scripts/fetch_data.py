#!/usr/bin/env python3
"""
금리·물가 알리미 — 자동 데이터 수집 스크립트.

한국은행 ECOS API(기준금리 722Y001/0101000, 소비자물가지수 901Y009/0)와
미 FRED API(연방기금금리 목표 상단 DFEDTARU, CPI-U NSA CPIAUCNS)에서
최신 데이터를 받아 series.js를 다시 만듭니다.

물가 상승률(YoY %)은 지수값을 직접 받아 (당월/전년동월 - 1) * 100 으로
이 스크립트가 직접 계산합니다 — ECOS/FRED의 "등락률" 통계표 코드를
추측해 쓰는 대신, 원 지수에서 표준 정의대로 계산해 정확성을 보장합니다.

필요 환경변수: ECOS_API_KEY, FRED_API_KEY
사용법: python scripts/fetch_data.py
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

CPI_START = "2021-07"          # 화면에 표시할 물가/금리 데이터 시작월
INDEX_FETCH_START = "2020-07"  # YoY 계산을 위해 1년 더 앞서 지수를 받아옴

ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"


def http_get_json(url, label):
    req = urllib.request.Request(url, headers={"User-Agent": "rate-alert-pwa/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise RuntimeError(f"{label} 요청 실패: {e}") from e


def month_range(start_ym, end_ym):
    y, m = map(int, start_ym.split("-"))
    ey, em = map(int, end_ym.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m = 1
            y += 1
    return out


def to_change_points(monthly_last):
    """{ym: value} → [[ym, value], ...] 값이 바뀐 시점만."""
    points = []
    prev = None
    for ym in sorted(monthly_last):
        v = round(monthly_last[ym], 2)
        if prev is None or v != prev:
            points.append([ym, v])
            prev = v
    return points


def yoy_list(index_by_ym, months):
    """월별 지수값 dict → 전년동월비 %(반올림 1자리) 리스트. 결측은 None."""
    out = []
    for ym in months:
        y, m = map(int, ym.split("-"))
        py = f"{y - 1:04d}-{m:02d}"
        cur = index_by_ym.get(ym)
        prev = index_by_ym.get(py)
        if cur is None or prev is None or prev == 0:
            out.append(None)
        else:
            out.append(round((cur / prev - 1) * 100, 1))
    return out


# ---------------- 한국은행 ECOS ----------------

def ecos_rate_kr(api_key, start_ym, end_ym):
    start = start_ym.replace("-", "") + "01"
    end = end_ym.replace("-", "") + "31"
    url = f"{ECOS_BASE}/{api_key}/json/kr/1/3000/722Y001/D/{start}/{end}/0101000"
    data = http_get_json(url, "ECOS 기준금리")
    if "StatisticSearch" not in data:
        raise RuntimeError(f"ECOS 기준금리 응답 오류: {data}")
    monthly_last = {}
    for row in data["StatisticSearch"]["row"]:
        t = row["TIME"]  # YYYYMMDD
        ym = f"{t[0:4]}-{t[4:6]}"
        monthly_last[ym] = float(row["DATA_VALUE"])  # 날짜 오름차순 → 마지막 값이 월말값
    return monthly_last


def ecos_cpi_index_kr(api_key, start_ym, end_ym):
    start = start_ym.replace("-", "")
    end = end_ym.replace("-", "")
    url = f"{ECOS_BASE}/{api_key}/json/kr/1/3000/901Y009/M/{start}/{end}/0"
    data = http_get_json(url, "ECOS 소비자물가지수")
    if "StatisticSearch" not in data:
        raise RuntimeError(f"ECOS 물가지수 응답 오류: {data}")
    idx = {}
    for row in data["StatisticSearch"]["row"]:
        t = row["TIME"]  # YYYYMM
        idx[f"{t[0:4]}-{t[4:6]}"] = float(row["DATA_VALUE"])
    return idx


# ---------------- 미 FRED ----------------

def fred_observations(series_id, api_key, start_date, extra=""):
    url = (f"{FRED_BASE}?series_id={series_id}&api_key={api_key}"
           f"&file_type=json&observation_start={start_date}{extra}")
    data = http_get_json(url, f"FRED {series_id}")
    if "observations" not in data:
        raise RuntimeError(f"FRED {series_id} 응답 오류: {data}")
    return data["observations"]


def fred_rate_us(api_key, start_ym):
    start_date = start_ym + "-01"
    # frequency=m&aggregation_method=eop → 월말(기간 종료 시점) 값 하나씩
    obs = fred_observations("DFEDTARU", api_key, start_date, "&frequency=m&aggregation_method=eop")
    monthly_last = {}
    for o in obs:
        if o["value"] == ".":
            continue
        monthly_last[o["date"][0:7]] = float(o["value"])
    return monthly_last


def fred_cpi_index_us(api_key, start_ym):
    start_date = start_ym + "-01"
    obs = fred_observations("CPIAUCNS", api_key, start_date)
    idx = {}
    for o in obs:
        if o["value"] == ".":
            continue
        idx[o["date"][0:7]] = float(o["value"])
    return idx


# ---------------- 검증 ----------------

def sanity_check(rate_kr, rate_us, cpi_kr, cpi_us, months):
    problems = []
    if not rate_kr or not (0 <= rate_kr[-1][1] <= 15):
        problems.append("한국 기준금리 값이 비정상입니다")
    if not rate_us or not (0 <= rate_us[-1][1] <= 15):
        problems.append("미국 기준금리 값이 비정상입니다")
    recent_kr = [v for v in cpi_kr[-3:] if v is not None]
    recent_us = [v for v in cpi_us[-3:] if v is not None]
    if not recent_kr:
        problems.append("최근 3개월 한국 물가상승률이 모두 결측입니다")
    if not recent_us:
        problems.append("최근 3개월 미국 물가상승률이 모두 결측입니다")
    if problems:
        raise RuntimeError("데이터 검증 실패: " + "; ".join(problems))


# ---------------- series.js 렌더링 ----------------

def render_js(rate_kr, rate_us, cpi_kr, cpi_us, as_of, version):
    def pairs(points):
        return "[\n" + ",\n".join(f'    ["{ym}", {v:.2f}]' for ym, v in points) + "\n  ]"

    def nums(values):
        body = ", ".join("null" if v is None else f"{v:.1f}" for v in values)
        return f"[\n    {body}\n  ]"

    return f"""/* ============================================================
 * 자동 생성 파일 — scripts/fetch_data.py가 GitHub Actions에서
 * 한국은행 ECOS API·미 FRED API로부터 매일 갱신합니다.
 * 손으로 고치지 마세요 — 다음 실행 때 덮어써집니다.
 * (수동 override는 앱의 "새 발표값 입력" 기능을 쓰세요.)
 * ============================================================ */
const SERIES_DATA = {{
  meta: {{
    dataAsOf: "{as_of}",
    version: {version}
  }},

  /* 정책금리 변경 시점 (해당 월부터 적용). 미국은 목표범위 '상단' 기준 */
  rateKR: {pairs(rate_kr)},
  rateUS: {pairs(rate_us)},

  /* 소비자물가 상승률(전년동월비 %) — {CPI_START} ~ 최신월, null = 미발표 */
  cpiKR: {nums(cpi_kr)},
  cpiUS: {nums(cpi_us)},
  cpiStart: "{CPI_START}"
}};
if (typeof self !== "undefined") self.SERIES_DATA = SERIES_DATA;
"""


def main():
    ecos_key = os.environ.get("ECOS_API_KEY")
    fred_key = os.environ.get("FRED_API_KEY")
    if not ecos_key or not fred_key:
        print("ECOS_API_KEY / FRED_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    today_kst = datetime.now(ZoneInfo("Asia/Seoul")).date()
    end_ym = f"{today_kst.year:04d}-{today_kst.month:02d}"

    print("한국 기준금리 조회 중...")
    kr_rate_daily = ecos_rate_kr(ecos_key, CPI_START, end_ym)
    print("한국 소비자물가지수 조회 중...")
    kr_idx = ecos_cpi_index_kr(ecos_key, INDEX_FETCH_START, end_ym)
    print("미국 기준금리 조회 중...")
    us_rate_monthly = fred_rate_us(fred_key, CPI_START)
    print("미국 소비자물가지수 조회 중...")
    us_idx = fred_cpi_index_us(fred_key, INDEX_FETCH_START)

    months = month_range(CPI_START, end_ym)
    cpi_kr = yoy_list(kr_idx, months)
    cpi_us = yoy_list(us_idx, months)
    rate_kr = to_change_points(kr_rate_daily)
    rate_us = to_change_points(us_rate_monthly)

    sanity_check(rate_kr, rate_us, cpi_kr, cpi_us, months)

    as_of = today_kst.isoformat()
    version = int(today_kst.strftime("%Y%m%d"))
    js = render_js(rate_kr, rate_us, cpi_kr, cpi_us, as_of, version)

    out_path = os.path.join(os.path.dirname(__file__), "..", "series.js")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)

    print(f"완료: {out_path} 갱신 (기준일 {as_of})")
    print(f"  한국 기준금리 최신: {rate_kr[-1]}")
    print(f"  미국 기준금리 최신: {rate_us[-1]}")
    print(f"  한국 물가 최신: {cpi_kr[-1]}")
    print(f"  미국 물가 최신: {cpi_us[-1]}")


if __name__ == "__main__":
    main()
