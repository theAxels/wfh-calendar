import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'config/wfh.config.json');
const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'public', 'ics');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function assert(condition, message) { if (!condition) throw new Error(message); }
assert(Array.isArray(config.teams) && config.teams.length > 0, 'teams must be a non-empty array');
assert(Array.isArray(config.rotationOrder) && config.rotationOrder.length > 0, 'rotationOrder must be a non-empty array');
assert(config.rotationOrder.every(t => config.teams.includes(t)), 'Every rotationOrder team must exist in teams');
assert(config.rotationOrder.includes(config.startTeam), 'startTeam must be present in rotationOrder');
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.startDate), 'startDate must use YYYY-MM-DD');
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.endDate) && config.endDate >= config.startDate, 'endDate must be YYYY-MM-DD and not before startDate');
assert(config.holidayPolicy === 'skip-without-advancing', 'This generator supports holidayPolicy=skip-without-advancing');

const holidays = new Set(config.holidays ?? []);
const weekdays = new Set(config.eligibleWeekdays ?? [1,2,3,4,5]);
const dateToUtc = s => new Date(`${s}T00:00:00Z`);
const isoDate = d => d.toISOString().slice(0, 10);
const escapeText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad = n => String(n).padStart(2, '0');
function localDateTime(date, time) {
  const [hh, mm] = (time || '09:00').split(':').map(Number);
  return `${date.replaceAll('-', '')}T${pad(hh)}${pad(mm)}00`;
}
function foldLine(line) {
  const chunks = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) { chunks.push(current); current = ' ' + char; }
    else current += char;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}
function makeCalendar(name, events) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Open WFH Calendar Generator//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${escapeText(config.timezone || 'UTC')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.date}-${slug(event.team)}@wfh-calendar-generator`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART;TZID=${config.timezone || 'UTC'}:${localDateTime(event.date, config.eventStartTime)}`, `DTEND;TZID=${config.timezone || 'UTC'}:${localDateTime(event.date, config.eventEndTime)}`, `SUMMARY:${escapeText(`${event.team} — WFH`)}`, `DESCRIPTION:${escapeText(config.description || 'Work From Home day')}`, `CATEGORIES:${escapeText(event.team)},WFH`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

const events = [];
let rotationIndex = config.rotationOrder.indexOf(config.startTeam);
for (let day = dateToUtc(config.startDate), last = dateToUtc(config.endDate); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
  const date = isoDate(day);
  if (!weekdays.has(day.getUTCDay()) || holidays.has(date)) continue;
  events.push({ date, team: config.rotationOrder[rotationIndex] });
  rotationIndex = (rotationIndex + 1) % config.rotationOrder.length;
}
fs.mkdirSync(outputDir, { recursive: true });
const year = String(config.year || config.startDate.slice(0, 4));
fs.writeFileSync(path.join(outputDir, `${year}.ics`), makeCalendar(`${config.calendarName} ${year} — All Teams`, events));
for (const team of config.teams) {
  fs.writeFileSync(path.join(outputDir, `${slug(team)}-${year}.ics`), makeCalendar(`${config.calendarName} ${year} — ${team}`, events.filter(e => e.team === team)));
}
fs.writeFileSync(path.join(outputDir, 'index.json'), JSON.stringify({ calendarName: config.calendarName, year, generatedAt: new Date().toISOString(), totalEvents: events.length, teams: config.teams.map(team => ({ team, events: events.filter(e => e.team === team).length, file: `${slug(team)}-${year}.ics` })), combinedFile: `${year}.ics` }, null, 2) + '\n');
console.log(`Generated ${events.length} eligible WFH events across ${config.startDate}..${config.endDate} in ${outputDir}`);
console.log(`Rotation begins with ${config.startTeam} on the first eligible date at or after ${config.startDate}.`);
