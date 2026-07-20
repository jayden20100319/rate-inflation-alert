/* ============================================================
 * series.js(자동 갱신)와 schedule.js(수동 관리)를 하나로 합쳐
 * 기존 앱 코드가 기대하는 BASE_DATA 전역을 만들어 줍니다.
 * 로드 순서: series.js → schedule.js → data.js → app.js
 * ============================================================ */
const BASE_DATA = Object.assign({}, SERIES_DATA, SCHEDULE_DATA);
if (typeof self !== "undefined") self.BASE_DATA = BASE_DATA;
