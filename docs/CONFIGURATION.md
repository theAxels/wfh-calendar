# Configuration reference

Edit `config/wfh.config.json`, then run `npm run generate`.

```json
{
  "calendarName": "WFH Calendar",
  "timezone": "Asia/Jakarta",
  "startDate": "2026-10-09",
  "endDateMode": "rolling",
  "rollingYearsAhead": 5,
  "startTeam": "Team A",
  "teams": ["Team A", "Team B", "Team C", "Team D"],
  "rotationOrder": ["Team A", "Team B", "Team C", "Team D"],
  "eligibleWeekdays": [1, 2, 3, 4, 5],
  "holidayPolicy": "skip-without-advancing",
  "holidaySource": { "mode": "tanggalmerah-api", "baseUrl": "https://tanggalmerah.upset.dev", "timeoutMs": 10000 },
  "holidays": [],
  "description": "Work From Home day."
}
```

## Stable subscription URLs

These filenames never change when the year changes:

- `public/ics/all.ics` — every team's WFH events
- `public/ics/team-a.ics` — only Team A (one stable file per configured team)

The generator also retains year-specific feeds such as `2026.ics` and `team-a-2026.ics` for backward compatibility. Rotation continues from `startDate` across year boundaries; it does not restart each January.

## Rolling horizon

With `endDateMode: "rolling"`, the requested end date is December 31 of the current UTC year plus `rollingYearsAhead`. Set `rollingYearsAhead` from 1 to 15. When `tanggalmerah-api` is enabled, the actual generated end date is capped at the latest consecutive year with published holiday data; the manifest records both the requested and actual coverage. For a fixed end date, use `endDateMode: "fixed"` and provide `endDate: "YYYY-MM-DD"` (API coverage can still cap the effective date).

## Public holidays — important

Holiday dates are never inferred from weekdays or silently treated as complete. The recommended `holidaySource.mode: "tanggalmerah-api"` is consumed by `scripts/sync-holidays.mjs`, not by the generator. The sync workflow discovers `/api/years`, fetches each new or forced year, validates the response, and stores last-known-good cache files in `data/holidays/YYYY.json`. `scripts/generate-ics.mjs` reads only those local files and caps feeds at the latest consecutive cached year. If the API fails or returns invalid data, the cache is preserved and the workflow fails; a missing year is never assumed to contain zero holidays.

The currently implemented sync script uses Tanggal Merah API. The custom JSON and manual modes below describe the broader configuration format; do not select those modes unless the corresponding sync implementation has been added and tested. For a custom hosted JSON holiday source, use:

```json
"holidaySource": {
  "mode": "json-url",
  "url": "https://example.org/holidays.json",
  "timeoutMs": 10000
}
```

The endpoint must return either an array of date strings (`["2027-01-01", "2027-03-11"]`) or an object with a `holidays` array (`{"holidays":[{"date":"2027-01-01"}]}`). Configured `holidays` are merged with remote dates. If the endpoint is unavailable, responds with an error, or returns invalid data, generation fails instead of publishing a calendar that may incorrectly include a holiday. Only use a trusted, maintained source that covers the full horizon.

## Rotation rules

- Weekday values: Sunday `0`, Monday `1`, Tuesday `2`, Wednesday `3`, Thursday `4`, Friday `5`, Saturday `6`.
- `rotationOrder` controls the rotation sequence and can include any configured teams.
- `startTeam` is assigned to the first eligible non-holiday date on or after `startDate`.
- Weekends and listed holidays are skipped without advancing the rotation pointer.
- Team names should be unique. Their feed filenames are generated as lowercase slugs; avoid team names that normalize to the same slug.
