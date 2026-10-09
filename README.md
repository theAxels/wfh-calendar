# WFH Calendar Generator

A configurable WFH rotation calendar with stable, subscribable ICS feeds, a GitHub Pages guide, and automated regeneration.

**Live site:** https://theaxels.github.io/wfh-calendar/

## Stable calendar subscription URLs

Subscribe once to these stable URLs; their contents are regenerated as the horizon moves forward:

- All teams: `https://theaxels.github.io/wfh-calendar/ics/all.ics`
- Team A: `https://theaxels.github.io/wfh-calendar/ics/team-a.ics`
- Team B: `https://theaxels.github.io/wfh-calendar/ics/team-b.ics`
- Team C: `https://theaxels.github.io/wfh-calendar/ics/team-c.ics`
- Team D: `https://theaxels.github.io/wfh-calendar/ics/team-d.ics`

If you add or rename teams, the generator creates a stable feed for each configured team. Existing year-specific feeds are also generated for backward compatibility.

## Generate locally

Requires Node.js 20 or newer.

```bash
npm run generate
```

This writes the `.ics` files and `public/ics/index.json`. The website reads that manifest to show feed links and event counts. The requested rolling horizon is five years, but with the Tanggal Merah API enabled the published calendar is capped at the latest consecutive year for which holiday data exists. When the API adds later years, the scheduled workflow extends the same stable feed URLs. Rotation continues across January 1 and does not reset annually.

## Configure the rotation

Edit `config/wfh.config.json`. `startTeam` is assigned to the first eligible weekday on or after `startDate`. `rotationOrder` determines the repeating sequence. Weekends and listed public holidays are skipped without advancing the team pointer.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for fixed/rolling horizons, dynamic teams, and holiday source settings.

## Public holiday data

The sync script uses the public [Tanggal Merah API](https://upset.dev/tanggalmerah) to discover published years and validate national holidays and collective leave. It stores last-known-good data in `data/holidays/YYYY.json`. The calendar generator reads only this local cache and never calls the API directly. Generated feeds stop at the latest consecutive cached year; a missing year is never treated as holiday-free. The API is a third-party source, not an official government source, and automated validation does not certify its dates.

## GitHub Actions

- `Sync holiday cache` runs weekly and can be started manually. It validates and commits cache/status updates and regenerates the stable feeds after successful syncs.
- `CI` runs syntax/generation checks and tests for pushes and pull requests.
- `Deploy calendar feeds to GitHub Pages` publishes the `public/` directory.

Ensure GitHub Pages is configured to use **GitHub Actions** as its build/deployment source. Subscribe using the HTTPS feed URLs, not a downloaded `.ics` file, to receive updates when your calendar app refreshes its subscription.

## Notes

- ICS feeds are public. Feeds contain team-level WFH events only; do not add private employee names or confidential information.
- Refresh timing is controlled by each calendar provider; a stable URL does not guarantee an immediate refresh.
- The generated feed contains timed events using the configured IANA timezone.

## Holiday sync system

The weekly workflow discovers years from the Tanggal Merah API, validates each new or forced year, and stores last-known-good datasets under `data/holidays/YYYY.json`. The generator reads local files only. Invalid responses do not replace a valid cached year. If a future year is not published, the calendar ends at the last consecutive cached year; missing years are never assumed to have zero holidays.

## Working hours

All generated WFH events use the Regular schedule in WIB:

- Clock in: **08:30 WIB**
- Clock out: **17:30 WIB**
- Lunch: **12:00–13:00 WIB** (included in the event description; not a separate event)
- Timezone: `Asia/Jakarta`

The calendar publishes team-level events, not employee-specific schedules. Holidays and collective leave are skipped without advancing the rotation.

## Manual overrides

Use `data/holidays/overrides.json` to document corrections from official Indonesian government announcements. Overrides take precedence over API data and each item must include the holiday date, name, source URL, reason, verifier, and verification timestamp.

## Run a manual sync

```bash
npm run sync-holidays -- --year=2027
npm run sync-holidays -- --dry-run
npm run sync-holidays -- --force
```
