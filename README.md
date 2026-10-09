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

This writes the `.ics` files and `public/ics/index.json`. The website reads that manifest to show feed links and event counts. The default horizon ends on December 31 five years after the current UTC year. Rotation continues across January 1 and does not reset annually.

## Configure the rotation

Edit `config/wfh.config.json`. `startTeam` is assigned to the first eligible weekday on or after `startDate`. `rotationOrder` determines the repeating sequence. Weekends and listed public holidays are skipped without advancing the team pointer.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for fixed/rolling horizons, dynamic teams, and holiday source settings.

## Public holiday data

The default mode is explicit/manual. It honors only dates in `holidays` and prints a warning so maintainers know the list needs updates. For automated holiday data, configure a trusted HTTPS JSON endpoint with `holidaySource.mode: "json-url"`. If a configured remote source fails or returns invalid data, generation stops instead of publishing a potentially incorrect calendar. Review the source and its coverage before enabling it.

## GitHub Actions

- `Generate WFH calendars` runs monthly and can be started manually. It commits updated stable and annual feeds when files change.
- `Deploy calendar feeds to GitHub Pages` publishes the `public/` directory.

Ensure GitHub Pages is configured to use **GitHub Actions** as its build/deployment source. Subscribe using the HTTPS feed URLs, not a downloaded `.ics` file, to receive updates when your calendar app refreshes its subscription.

## Notes

- ICS feeds are public. Do not include private employee names or confidential information.
- Refresh timing is controlled by each calendar provider; a stable URL does not guarantee an immediate refresh.
- The generated feed contains timed events using the configured IANA timezone.
