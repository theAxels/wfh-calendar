# Contributing

Thanks for helping improve WFH Calendar.

## Development setup

- Install Node.js 20 or newer.
- Clone the repository and install no dependencies; the project uses Node.js built-ins.
- Edit `config/wfh.config.json` for team rotation settings.
- Do not add employee names, private schedules, secrets, or confidential data to public files.

## Validate changes

Run these commands before opening a pull request:

```bash
npm run check
npm test
npm run sync-holidays -- --dry-run
```

The sync dry run contacts the configured public holiday API. Tests should use fixtures and must not depend on live API availability.

## Pull requests

- Explain the behavior change and any public feed impact.
- Add or update tests for behavior changes.
- Preserve existing subscription URLs.
- Never claim holiday dates are officially verified without citing the specific official announcement.
- Do not commit API credentials or personal information.
