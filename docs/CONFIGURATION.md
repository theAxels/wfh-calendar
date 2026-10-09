# Configuration reference

Example configuration for a four-team rotation:

```json
{
  "calendarName": "WFH Calendar",
  "timezone": "Asia/Jakarta",
  "year": 2026,
  "startDate": "2026-10-09",
  "endDate": "2026-12-31",
  "startTeam": "Team A",
  "teams": ["Team A", "Team B", "Team C", "Team D"],
  "rotationOrder": ["Team A", "Team B", "Team C", "Team D"],
  "eligibleWeekdays": [1, 2, 3, 4, 5],
  "holidayPolicy": "skip-without-advancing",
  "holidays": ["2026-12-25"],
  "eventStartTime": "09:00",
  "eventEndTime": "17:00",
  "description": "Work From Home day."
}
```

Weekday values: Sunday `0`, Monday `1`, Tuesday `2`, Wednesday `3`, Thursday `4`, Friday `5`, Saturday `6`. Holidays are explicit ISO dates and are skipped without moving the team pointer. The next eligible non-holiday date receives the team that would otherwise have been assigned.
