# US econ news calendar — maintenance

`news-calendar.json` feeds `src/lib/trading/news.ts` (`newsRead`) and the HUD
news chip. All times are **ET wall clock** (`timeEt`, 24h "HH:MM"); dates are
`YYYY-MM-DD`. Impact is `"high"` or `"medium"`.

## Current coverage

2026-08-10 → 2026-09-16. Every date below was verified against the issuing
agency's own schedule on 2026-08-10:

| Event | Source (fetched 2026-08-10) |
|---|---|
| CPI Aug 12 + Sep 11, 08:30 | bls.gov/schedule/news_release/cpi.htm |
| PPI Aug 13 + Sep 10, 08:30 | bls.gov/schedule/news_release/ppi.htm |
| Employment Situation (NFP) Sep 4, 08:30 | bls.gov/schedule/news_release/empsit.htm |
| GDP Q2 2nd est + PCE (Jul) Aug 26, 08:30 (same day per BEA) | bea.gov/news/schedule |
| Retail Sales (Advance) Aug 14 + Sep 16, 08:30 | census.gov/retail/release_schedule.html |
| ISM Mfg Sep 1 + Services Sep 3, 10:00 | ismworld.org rob-report-calendar |
| FOMC decision Sep 15–16 meeting (statement Sep 16 14:00) | federalreserve.gov/monetarypolicy/fomccalendars.htm |
| FOMC minutes Aug 19 14:00 | Derived: Fed states minutes release exactly 3 weeks after the policy decision (Jul 29 + 21d = Aug 19; pattern confirmed on every 2026 meeting listed) |

## Weekly maintenance (do this every Sunday)

1. Fetch the five official schedules above — **never** copy dates from
   third-party forex calendars or from memory.
2. Drop entries whose date has passed; append newly-in-window releases so the
   file always covers "today + ~5 weeks".
3. Keep `timeEt` in ET. BLS/BEA/Census releases are 08:30, ISM 10:00, FOMC
   statement 14:00, minutes 14:00. If an agency shifts a time, the schedule
   page is the truth.
4. High = CPI, PPI, NFP, Retail Sales, PCE, FOMC (decision + minutes), ISM,
   GDP advance. Medium = GDP 2nd/3rd estimates and anything secondary.
5. Never invent a date. If a release cannot be verified from the issuing
   agency, leave it out — `newsRead` degrades gracefully to "clear".
