import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'config/wfh.config.json');
const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'public', 'ics');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function assert(condition, message) { if (!condition) throw new Error(message); }
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
assert(Array.isArray(config.teams) && config.teams.length > 0, 'teams must be a non-empty array');
assert(new Set(config.teams).size === config.teams.length, 'teams must not contain duplicates');
assert(new Set(config.teams.map(slug)).size === config.teams.length, 'Team names must produce unique feed filenames after slug normalization');
assert(Array.isArray(config.rotationOrder) && config.rotationOrder.length > 0, 'rotationOrder must be a non-empty array');
assert(new Set(config.rotationOrder).size === config.rotationOrder.length, 'rotationOrder must not contain duplicates');
assert(config.rotationOrder.every(team => config.teams.includes(team)), 'Every rotationOrder team must exist in teams');
assert(config.rotationOrder.includes(config.startTeam), 'startTeam must be present in rotationOrder');
assert(isDate(config.startDate), 'startDate must use a valid YYYY-MM-DD date');
assert(config.holidayPolicy === 'skip-without-advancing', 'This generator supports holidayPolicy=skip-without-advancing');
assert(Array.isArray(config.eligibleWeekdays) && config.eligibleWeekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6), 'eligibleWeekdays must be weekday numbers from 0 to 6');
assert(/^\d{2}:\d{2}$/.test(config.eventStartTime) && /^\d{2}:\d{2}$/.test(config.eventEndTime), 'eventStartTime and eventEndTime must use HH:MM');

const dateToUtc = value => new Date(`${value}T00:00:00Z`);
const isoDate = date => date.toISOString().slice(0, 10);
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team'; }
const escapeText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad = value => String(value).padStart(2, '0');
function localDateTime(date, time) {
  const [hour, minute] = time.split(':').map(Number);
  assert(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59, `Invalid time: ${time}`);
  return `${date.replaceAll('-', '')}T${pad(hour)}${pad(minute)}00`;
}
function foldLine(line) {
  const chunks = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) { chunks.push(current); current = ` ${char}`; }
    else current += char;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}
function makeCalendar(name, events) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Axel Studio//WFH Calendar Generator 2.0//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${escapeText(config.timezone || 'UTC')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'
  ];
  for (const event of events) {
    // Stable UIDs let calendar clients recognize updates to an existing event.
    const uid = `${event.date}-${slug(event.team)}@wfh-calendar-generator`;
    lines.push(
      'BEGIN:VEVENT', `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;TZID=${config.timezone || 'UTC'}:${localDateTime(event.date, config.eventStartTime)}`,
      `DTEND;TZID=${config.timezone || 'UTC'}:${localDateTime(event.date, config.eventEndTime)}`,
      `SUMMARY:${escapeText(`${event.team} — WFH`)}`,
      `DESCRIPTION:${escapeText(config.description || 'Work From Home day')}`,
      `CATEGORIES:${escapeText(event.team)},WFH`, 'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

async function loadHolidays() {
  const configured = config.holidays ?? [];
  assert(Array.isArray(configured) && configured.every(isDate), 'holidays must be an array of valid YYYY-MM-DD dates');
  const source = config.holidaySource ?? { mode: 'manual' };
  if (source.mode === 'manual') {
    console.warn('NOTICE: holidaySource.mode is "manual"; only dates listed in config.holidays are skipped. Keep this list updated for every year in the generated horizon.');
    return new Set(configured);
  }
  if (source.mode !== 'json-url' || typeof source.url !== 'string' || !/^https:\/\//i.test(source.url)) {
    throw new Error('holidaySource must use mode "manual" or mode "json-url" with a valid HTTPS url.');
  }
  let response;
  try {
    response = await fetch(source.url, { signal: AbortSignal.timeout(source.timeoutMs ?? 10000), headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(`Holiday source could not be reached; refusing to generate a calendar without holiday data. ${error.message}`);
  }
  if (!response.ok) throw new Error(`Holiday source returned HTTP ${response.status}; refusing to generate a calendar without holiday data.`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('Holiday source did not return valid JSON; refusing to generate a calendar without holiday data.'); }
  const remoteDates = Array.isArray(payload) ? payload : payload?.holidays;
  if (!Array.isArray(remoteDates) || !remoteDates.every(item => isDate(typeof item === 'string' ? item : item?.date))) {
    throw new Error('Holiday JSON must be an array of YYYY-MM-DD strings or an object with a holidays array containing YYYY-MM-DD strings / {date} objects.');
  }
  return new Set([...configured, ...remoteDates.map(item => typeof item === 'string' ? item : item.date)]);
}

function getEndDate() {
  if (config.endDateMode === 'rolling') {
    const yearsAhead = Number(config.rollingYearsAhead ?? 5);
    assert(Number.isInteger(yearsAhead) && yearsAhead >= 1 && yearsAhead <= 15, 'rollingYearsAhead must be an integer from 1 to 15');
    const endYear = new Date().getUTCFullYear() + yearsAhead;
    return `${endYear}-12-31`;
  }
  const endDate = config.endDate;
  assert(isDate(endDate) && endDate >= config.startDate, 'endDate must be a valid YYYY-MM-DD date not before startDate, or set endDateMode to rolling');
  return endDate;
}

const endDate = getEndDate();
const holidays = await loadHolidays();
const weekdays = new Set(config.eligibleWeekdays);
const events = [];
let rotationIndex = config.rotationOrder.indexOf(config.startTeam);
for (let day = dateToUtc(config.startDate), last = dateToUtc(endDate); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
  const date = isoDate(day);
  if (!weekdays.has(day.getUTCDay()) || holidays.has(date)) continue;
  events.push({ date, team: config.rotationOrder[rotationIndex] });
  rotationIndex = (rotationIndex + 1) % config.rotationOrder.length;
}

fs.mkdirSync(outputDir, { recursive: true });
const allFile = 'all.ics';
fs.writeFileSync(path.join(outputDir, allFile), makeCalendar(`${config.calendarName} — All Teams`, events));
const teamEntries = config.teams.map(team => {
  const teamEvents = events.filter(event => event.team === team);
  const file = `${slug(team)}.ics`;
  fs.writeFileSync(path.join(outputDir, file), makeCalendar(`${config.calendarName} — ${team}`, teamEvents));
  return { team, events: teamEvents.length, file };
});

// Keep annual feeds for compatibility with existing subscribers and links.
const firstYear = Number(config.startDate.slice(0, 4));
const lastYear = Number(endDate.slice(0, 4));
const annualFeeds = [];
for (let year = firstYear; year <= lastYear; year++) {
  const annualEvents = events.filter(event => Number(event.date.slice(0, 4)) === year);
  const combinedFile = `${year}.ics`;
  fs.writeFileSync(path.join(outputDir, combinedFile), makeCalendar(`${config.calendarName} ${year} — All Teams`, annualEvents));
  for (const team of config.teams) {
    fs.writeFileSync(path.join(outputDir, `${slug(team)}-${year}.ics`), makeCalendar(`${config.calendarName} ${year} — ${team}`, annualEvents.filter(event => event.team === team)));
  }
  annualFeeds.push({ year, file: combinedFile, events: annualEvents.length });
}

const manifest = {
  calendarName: config.calendarName,
  generatedAt: new Date().toISOString(),
  startDate: config.startDate,
  endDate,
  timezone: config.timezone || 'UTC',
  totalEvents: events.length,
  stable: { combinedFile: allFile, teams: teamEntries },
  // Legacy fields retained for older versions of the website that read index.json.
  year: lastYear,
  combinedFile: allFile,
  teams: teamEntries,
  annualFeeds,
  holidaySourceMode: (config.holidaySource ?? { mode: 'manual' }).mode
};
fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${events.length} eligible WFH events from ${config.startDate} through ${endDate}.`);
console.log(`Stable feeds: ${allFile}, ${teamEntries.map(entry => entry.file).join(', ')}`);
console.log(`Rotation continues across calendar-year boundaries; skipped weekends/holidays do not advance the team pointer.`);
