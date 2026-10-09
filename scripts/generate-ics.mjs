import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function slug(value) {
  return String(value ?? 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
}

export function getHolidayDates(rootDir = ROOT) {
  const holidayDir = path.join(rootDir, 'data', 'holidays');
  if (!fs.existsSync(holidayDir)) return new Set();

  const holidayFiles = fs
    .readdirSync(holidayDir)
    .filter(name => /^\d{4}\.json$/.test(name))
    .sort();

  const holidaySet = new Set();
  for (const file of holidayFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(holidayDir, file), 'utf8'));
    const entries = Array.isArray(raw?.holidays) ? raw.holidays : Array.isArray(raw) ? raw : [];
    for (const item of entries) {
      const date = typeof item === 'string' ? item : item?.date;
      if (typeof date === 'string' && isIsoDate(date)) holidaySet.add(date);
    }
  }

  const overridesPath = path.join(holidayDir, 'overrides.json');
  if (fs.existsSync(overridesPath)) {
    const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    if (Array.isArray(overrides)) {
      for (const override of overrides) {
        const date = override?.date;
        if (typeof date === 'string' && isIsoDate(date)) holidaySet.add(date);
      }
    }
  }

  return holidaySet;
}

export function getLatestVerifiedDate(rootDir = ROOT) {
  const holidayDir = path.join(rootDir, 'data', 'holidays');
  if (!fs.existsSync(holidayDir)) return null;

  let latest = null;
  for (const file of fs.readdirSync(holidayDir)) {
    if (!/^\d{4}\.json$/.test(file)) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(holidayDir, file), 'utf8'));
    const year = Number(file.slice(0, 4));
    const dates = Array.isArray(raw?.holidays) ? raw.holidays : [];
    if (dates.length === 0) continue;
    for (const item of dates) {
      const date = typeof item === 'string' ? item : item?.date;
      if (typeof date === 'string' && isIsoDate(date)) {
        if (!latest || date > latest) latest = date;
      }
    }
    if (year >= Number(latest?.slice(0, 4) ?? 0)) {
      const lastDay = `${year}-12-31`;
      if (!latest || lastDay > latest) latest = lastDay;
    }
  }
  return latest;
}

function getEventWindow(scheme) {
  if (scheme === 'flexi') return { start: '08:30', end: '18:30' };
  return { start: '08:30', end: '17:30' };
}

function makeTimezoneBlock() {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Jakarta',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0700',
    'TZOFFSETTO:+0700',
    'TZNAME:WIB',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];
}

function escapeText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateTime(date, time) {
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) throw new Error(`Invalid time value: ${time}`);
  return `${date.replaceAll('-', '')}T${pad(hour)}${pad(minute)}00`;
}

function foldLine(line) {
  const chunks = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) {
      chunks.push(current);
      current = ` ${char}`;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

export function makeCalendar(name, events, config, scheme = 'regular') {
  const window = getEventWindow(scheme);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//theAxels//wfh-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${escapeText(config.timezone || 'Asia/Jakarta')}`,
    ...makeTimezoneBlock()
  ];

  for (const event of events) {
    const id = `${event.date}-${slug(event.team)}@theaxels.github.io`;
    const summary = `${event.team} — WFH`;
    const description = scheme === 'flexi'
      ? 'Clock in 08:30–09:30 WIB · Clock out 8h later (max 18:30) · Lunch 12:00–13:00'
      : 'Clock in 08:30 WIB · Clock out 17:30 WIB · Lunch 12:00–13:00';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${id}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;TZID=Asia/Jakarta:${localDateTime(event.date, window.start)}`,
      `DTEND;TZID=Asia/Jakarta:${localDateTime(event.date, window.end)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `CATEGORIES:${escapeText(event.team)},WFH`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getEndDate(config) {
  if (config.endDateMode === 'rolling') {
    const yearsAhead = Number(config.rollingYearsAhead ?? 5);
    assert(Number.isInteger(yearsAhead) && yearsAhead >= 1 && yearsAhead <= 15, 'rollingYearsAhead must be an integer from 1 to 15');
    const endYear = new Date().getUTCFullYear() + yearsAhead;
    return `${endYear}-12-31`;
  }
  const endDate = config.endDate;
  assert(isIsoDate(endDate) && endDate >= config.startDate, 'endDate must be a valid YYYY-MM-DD date not before startDate');
  return endDate;
}

export async function generateIcs(configPathOverride, outputDirOverride) {
  const configPath = configPathOverride ? path.resolve(configPathOverride) : path.join(ROOT, 'config', 'wfh.config.json');
  const outputDir = outputDirOverride ? path.resolve(outputDirOverride) : path.join(ROOT, 'public', 'ics');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert(Array.isArray(config.teams) && config.teams.length > 0, 'teams must be a non-empty array');
  assert(new Set(config.teams).size === config.teams.length, 'teams must not contain duplicates');
  assert(Array.isArray(config.rotationOrder) && config.rotationOrder.length > 0, 'rotationOrder must be a non-empty array');
  assert(new Set(config.rotationOrder).size === config.rotationOrder.length, 'rotationOrder must not contain duplicates');
  assert(config.rotationOrder.every(team => config.teams.includes(team)), 'Every rotationOrder team must exist in teams');
  assert(config.rotationOrder.includes(config.startTeam), 'startTeam must be present in rotationOrder');
  assert(isIsoDate(config.startDate), 'startDate must use a valid YYYY-MM-DD date');
  assert(Array.isArray(config.eligibleWeekdays) && config.eligibleWeekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6), 'eligibleWeekdays must be weekday numbers from 0 to 6');
  assert(/^\d{2}:\d{2}$/.test(config.eventStartTime) && /^\d{2}:\d{2}$/.test(config.eventEndTime), 'eventStartTime and eventEndTime must use HH:MM');

  const requestedEndDate = getEndDate(config);
  const holidaySet = getHolidayDates(ROOT);
  const latestVerifiedDate = getLatestVerifiedDate(ROOT) ?? config.startDate;
  const effectiveEndDate = requestedEndDate < latestVerifiedDate ? requestedEndDate : latestVerifiedDate;
  const start = new Date(`${config.startDate}T00:00:00Z`);
  const end = new Date(`${effectiveEndDate}T00:00:00Z`);
  const weekdays = new Set(config.eligibleWeekdays);
  const events = [];
  let rotationIndex = config.rotationOrder.indexOf(config.startTeam);

  for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const date = current.toISOString().slice(0, 10);
    if (!weekdays.has(current.getUTCDay()) || holidaySet.has(date)) continue;
    events.push({ date, team: config.rotationOrder[rotationIndex] });
    rotationIndex = (rotationIndex + 1) % config.rotationOrder.length;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const stableFiles = [{ team: 'All teams', file: 'all.ics', events: events.length }];
  const allCalendar = makeCalendar(`${config.calendarName} — All Teams`, events, config, 'regular');
  fs.writeFileSync(path.join(outputDir, 'all.ics'), allCalendar);

  for (const team of config.teams) {
    const teamEvents = events.filter(event => event.team === team);
    const filename = `${slug(team)}.ics`;
    fs.writeFileSync(path.join(outputDir, filename), makeCalendar(`${config.calendarName} — ${team}`, teamEvents, config, 'regular'));
    stableFiles.push({ team, file: filename, events: teamEvents.length });
  }

  const firstYear = Number(config.startDate.slice(0, 4));
  const lastYear = Number(effectiveEndDate.slice(0, 4));
  const annualFeeds = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const annualEvents = events.filter(event => Number(event.date.slice(0, 4)) === year);
    const combinedFile = `${year}.ics`;
    fs.writeFileSync(path.join(outputDir, combinedFile), makeCalendar(`${config.calendarName} ${year} — All Teams`, annualEvents, config, 'regular'));
    for (const team of config.teams) {
      fs.writeFileSync(path.join(outputDir, `${slug(team)}-${year}.ics`), makeCalendar(`${config.calendarName} ${year} — ${team}`, annualEvents.filter(event => event.team === team), config, 'regular'));
    }
    annualFeeds.push({ year, file: combinedFile, events: annualEvents.length });
  }

  for (const filename of fs.readdirSync(outputDir)) {
    const match = filename.match(/^(.*-)?(\d{4})\.ics$/);
    if (!match) continue;
    const year = Number(match[2]);
    if (year < firstYear || year > lastYear) fs.rmSync(path.join(outputDir, filename), { force: true });
  }

  const manifest = {
    calendarName: config.calendarName,
    generatedAt: new Date().toISOString(),
    startDate: config.startDate,
    endDate: effectiveEndDate,
    requestedEndDate,
    timezone: config.timezone || 'Asia/Jakarta',
    totalEvents: events.length,
    stable: { combinedFile: 'all.ics', teams: stableFiles },
    year: lastYear,
    combinedFile: 'all.ics',
    teams: stableFiles,
    annualFeeds,
    holidayCoverage: { requestedEndDate, coveredThrough: effectiveEndDate, latestVerifiedDate, capped: effectiveEndDate < requestedEndDate }
  };
  fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { events, startDate: config.startDate, endDate: effectiveEndDate, requestedEndDate, stableFiles, annualFeeds };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateIcs(process.argv[2], process.argv[3]);
    const startDate = result.stableFiles[0]?.startDate ?? 'N/A';
    const stableFeedList = result.stableFiles.filter(entry => entry.file !== 'all.ics').map(entry => entry.file);
    console.log(`Generated ${result.events.length} WFH events from ${result.requestedEndDate} through ${result.endDate}.`);
    console.log(`Stable feeds: all.ics, ${stableFeedList.join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

