# US econ news calendar — maintenance

`news-calendar.json` feeds `src/lib/trading/news.ts` (`newsRead`) and the HUD
news chip. All times are **ET wall clock** (`timeEt`, 24h "HH:MM"); dates are
`YYYY-MM-DD`. Impact is `"high"` or `"medium"`.

## Current coverage

2026-08-10 → 2026-10-02. Every date below was verified against the issuing
agency's own schedule (BLS / NY Fed / Fed calendar / BEA) on 2026-08-30:

| Event | Source (fetched 2026-08-10) |
|---|---|
| CPI Aug 12 + Sep 11, 08:30 | bls.gov/schedule/news_release/cpi.htm |
| PPI Aug 13 + Sep 10, 08:30 | bls.gov/schedule/news_release/ppi.htm |
| Employment Situation (NFP) Sep 4, 08:30 | bls.gov/schedule/news_release/empsit.htm |
| GDP Q2 2nd est + PCE (Jul) Aug 26, 08:30 (same day per BEA) | bea.gov/news/schedule |
| Retail Sales (Advance) Aug 14 + Sep 16, 08:30 | census.gov/retail/release_schedule.html |
| ISM Mfg Sep 1 + Services Sep 3, 10:00 | ismworld.org July Manufacturing + Services report pages ("will be released at 10:00 a.m. ET on …"). NOTE: the `rob-report-calendar` page is captcha-walled and cannot be fetched programmatically — use the current month's report pages instead. |
| FOMC decision Sep 15–16 meeting (statement Sep 16 14:00) | federalreserve.gov/monetarypolicy/fomccalendars.htm + newsevents/2026-september.htm |
| FOMC minutes Aug 19 14:00 | **Published, not derived**: federalreserve.gov/newsevents/2026-august.htm lists "FOMC Minutes / Meeting of July 28-29" on the 19th at 2:00 p.m. (The Fed's own wording is minutes are *generally* released three weeks after the policy decision — treat the 3-week rule as a hint, never as a source.) |

## Weekly maintenance (do this every Sunday)

1. Fetch the five official schedules above — **never** copy dates from
   third-party forex calendars or from memory.
2. Drop entries whose date has passed; append newly-in-window releases so the
   file always covers "today + ~5 weeks".
3. Keep `timeEt` in ET. BLS/BEA/Census releases are 08:30, ISM 10:00, FOMC
   statement 14:00, minutes 14:00. If an agency shifts a time, the schedule
   page is the truth. Caveat: only BLS ("All times on calendar are Eastern
   Time"), ISM ("a.m. ET") and the Fed state a timezone explicitly. BEA and
   Census print a bare "8:30 am" — ET is the long-standing convention for both,
   but it is not verifiable from their pages.
4. High = CPI, PPI, NFP, Retail Sales, PCE, FOMC (decision + minutes), ISM,
   GDP advance. Medium = GDP 2nd/3rd estimates and anything secondary.
5. Never invent a date. If a release cannot be verified from the issuing
   agency, leave it out — `newsRead` degrades gracefully to "clear".

## Known coverage gaps (independent verification, 2026-08-10)

The dates in the file are all correct, but the file is **not exhaustive**, and
`newsRead` returning "clear" therefore does not prove the tape is quiet. Absent
in-window agency releases, highest risk first:

- **Weekly initial jobless claims — every Thursday 08:30 ET (DOL/ETA).** Lands
  inside the NY AM killzone. **Added 2026-09-03 as medium** (week-ahead 2026-08-30).
  Remaining Thursdays still missing.
- JOLTS Sep 1 10:00 · **added high** (same window as ISM Mfg).
- ADP Employment Sep 2 08:15 · **added high** (ADP Research calendar; sits in NY AM).
- Still absent: Beige Book Sep 2 14:00 · BEA International Trade Sep 3 08:30 ·
  remaining weekly claims · BLS Import/Export Price Indexes Sep 16 08:30.
