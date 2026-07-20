/* ============================================================
 * 수동 관리 파일 — 금통위·FOMC·물가 발표 일정.
 * 한국은행·연준이 다음 해 회의 일정을 발표하면(보통 12월) 갱신하세요.
 * 자동 수집 스크립트(scripts/fetch_data.py)는 이 파일을 건드리지 않습니다.
 * ============================================================ */
const SCHEDULE_DATA = {
  /* 발표 일정. tentative=true 는 잠정(관례상 예상일) */
  schedule: [
    { date: "2026-07-29", kind: "rateUS", title: "미 연준 FOMC 금리 결정", note: "한국시간 7/30 새벽 3시 발표", tentative: false },
    { date: "2026-08-04", kind: "cpiKR",  title: "한국 7월 소비자물가동향(통계청)", note: "", tentative: true },
    { date: "2026-08-12", kind: "cpiUS",  title: "미국 7월 CPI(BLS)", note: "", tentative: true },
    { date: "2026-08-27", kind: "rateKR", title: "한국은행 금통위 기준금리 결정", note: "", tentative: false },
    { date: "2026-09-02", kind: "cpiKR",  title: "한국 8월 소비자물가동향(통계청)", note: "", tentative: true },
    { date: "2026-09-11", kind: "cpiUS",  title: "미국 8월 CPI(BLS)", note: "", tentative: true },
    { date: "2026-09-16", kind: "rateUS", title: "미 연준 FOMC 금리 결정", note: "한국시간 9/17 새벽 발표", tentative: false },
    { date: "2026-10-06", kind: "cpiKR",  title: "한국 9월 소비자물가동향(통계청)", note: "", tentative: true },
    { date: "2026-10-13", kind: "cpiUS",  title: "미국 9월 CPI(BLS)", note: "", tentative: true },
    { date: "2026-10-22", kind: "rateKR", title: "한국은행 금통위 기준금리 결정", note: "", tentative: false },
    { date: "2026-10-28", kind: "rateUS", title: "미 연준 FOMC 금리 결정", note: "한국시간 10/29 새벽 발표", tentative: false },
    { date: "2026-11-03", kind: "cpiKR",  title: "한국 10월 소비자물가동향(통계청)", note: "", tentative: true },
    { date: "2026-11-12", kind: "cpiUS",  title: "미국 10월 CPI(BLS)", note: "", tentative: true },
    { date: "2026-11-26", kind: "rateKR", title: "한국은행 금통위 기준금리 결정", note: "", tentative: false },
    { date: "2026-12-02", kind: "cpiKR",  title: "한국 11월 소비자물가동향(통계청)", note: "", tentative: true },
    { date: "2026-12-09", kind: "rateUS", title: "미 연준 FOMC 금리 결정", note: "한국시간 12/10 새벽 발표", tentative: false },
    { date: "2026-12-10", kind: "cpiUS",  title: "미국 11월 CPI(BLS)", note: "", tentative: true }
  ],

  kindLabel: {
    rateKR: "한국 기준금리",
    rateUS: "미국 기준금리",
    cpiKR: "한국 물가상승률",
    cpiUS: "미국 물가상승률"
  }
};
if (typeof self !== "undefined") self.SCHEDULE_DATA = SCHEDULE_DATA;
