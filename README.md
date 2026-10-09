# Public WFH Calendar Generator

A small, dependency-free Node.js project that generates public iCalendar (`.ics`) feeds for a rotating Work From Home schedule. Publish the `public/` directory with GitHub Pages and subscribe from Apple Calendar, Google Calendar, or Outlook.

## Default rules

- Teams: Team A, Team B, Team C, Team D
- Rotation: A → B → C → D → A
- Anchor: Team A on Friday, 9 October 2026
- Eligible days: Monday–Friday
- Holidays: dates listed in `holidays` are skipped **without advancing the rotation**
- Default range: 9 October–31 December 2026
- Time zone: `Asia/Jakarta`, event hours 09:00–17:00

The rotation advances only when a date is both an eligible weekday and not listed as a holiday. Because `startDate` is the anchor date in this configuration, Team A is assigned on 2026-10-09.

## Configure for another organization

Edit [`config/wfh.config.json`](config/wfh.config.json):

- `calendarName`: organization/calendar label
- `timezone`: IANA time zone, e.g. `Asia/Jakarta` or `America/New_York`
- `year`, `startDate`, `endDate`: output year and inclusive date range
- `startTeam`: team assigned on the first eligible date on/after `startDate`
- `teams` and `rotationOrder`: team names and rotation sequence (must use names from `teams`)
- `eligibleWeekdays`: JavaScript weekday numbers (`0` Sunday through `6` Saturday); default `[1,2,3,4,5]`
- `holidays`: explicit ISO dates (`YYYY-MM-DD`) to skip, e.g. `[`"`2026-12-25`"` , `"2027-01-01"` ]` (remove the backticks when editing JSON)
- `eventStartTime`, `eventEndTime`: local wall-clock event hours in `HH:mm`
- `description`: event description

**Holiday calendar note:** holidays are intentionally supplied as dates in the config. No country-specific holiday source is fetched automatically, so teams should verify and maintain the list for their location. If a holiday falls on a weekend it has no additional effect.

## Run locally

Requires Node.js 20 or newer; no npm dependencies are needed.

```sh
npm run generate
```

Generated files appear in `public/ics/`:

- `2026.ics` — all teams' WFH events
- `team-a-2026.ics`, `team-b-2026.ics`, etc. — one feed per team
- `index.json` — feed directory used by the landing page

To use another config/output path:

```sh
node scripts/generate-ics.mjs ./config/wfh.config.json ./public/ics
```

## Publish as a public GitHub repository

1. Create a new **public** repository on GitHub (for example, `wfh-calendar`).
2. Upload/commit the contents of this project to its `main` branch.
3. Open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
4. Open **Actions** and allow workflows if GitHub asks. Run **Generate WFH calendars** once if needed.
5. After `Deploy calendar feeds to GitHub Pages` succeeds, the site is available at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.
6. The combined feed URL will be `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/ics/2026.ics`; team feeds follow the pattern `.../ics/team-a-2026.ics`.

The generation workflow reruns after config/script changes, on manual dispatch, and monthly. It commits regenerated files; the Pages workflow then deploys them. For organizations needing a different refresh cadence, edit `.github/workflows/generate-calendar.yml`.

### If Actions cannot push generated files

Check **Settings → Actions → General → Workflow permissions** and allow read/write repository permissions. This is needed because the generator workflow commits the generated ICS files.

## Subscribe to feeds

Use the final HTTPS URL after publishing—not a local file path or a GitHub `blob` page URL.

- **iPhone / Apple Calendar:** Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar. Paste the HTTPS `.ics` URL, then save.
- **Google Calendar:** open Google Calendar on the web → Other calendars → `+` → From URL → paste the HTTPS `.ics` URL.
- **Outlook:** Add calendar → Subscribe from web → paste the HTTPS `.ics` URL.

Calendar clients decide how often to refresh subscribed feeds. Updates may be delayed by the client and are not guaranteed to appear instantly. If you only open/download an ICS file and import it, that is a one-time import, not a subscription.

## Security and privacy

Everything in a public repository and its published feeds is public. Use team labels, not employee names, and never include confidential information. This project does not use an API, server, database, tracking, or secrets.

## License

MIT. See [`LICENSE`](LICENSE).
