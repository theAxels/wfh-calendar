import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TZID = 'Asia/Jakarta';
const DEFAULT_EMPLOYEES = { defaultScheme: 'regular', timezone: TZID, employees: [] };

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function slug(value) {
  return String(value ?? 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

export function loadHolidayData(rootDir = ROOT) {
  const dir = path.join(rootDir, 'data', 'holidays');
  assert(fs.existsSync(dir), 'Holiday cache directory is missing; refusing to generate feeds.');
  const files = fs.readdirSync(dir).filter(file => /^\\d{4}\\.json$/.test(file)).sort();
  assert(files.length > 0, 'No verified holiday cache files found; refusing to assume zero holidays.');
  const years = new Map();
  const holidays = new Map();
  for (const file of files) {
    const year = Number(file.slice(0, 4));
    const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert(Number(record.year) === year && Array.isArray(record.holidays), `Invalid holiday cache envelope: ${file}`);
    const seen = new Set();
    let national = 0;
    for (const item of record.holidays) {
      assert(item && isIsoDate(item.date) && Number(item.date.slice(0, 4)) === year, `Invalid holiday date in ${file}`);
      assert(typeof item.name === 'string' && item.name.trim(), `Missing holiday name in ${file}`);
      assert(['national', 'collective_leave'].includes(item.type), `Invalid holiday type in ${file}: ${item.type}`);
      assert(!seen.has(item.date), `Duplicate holiday date in ${file}: ${item.date}`);
      seen.add(item.date);
      if (item.type === 'national') national++;
      holidays.set(item.date, item);
    }
    assert(national >= 10, `${year}.json has fewer than 10 national holidays.`);
    years.set(year, record);
  }
  const overridesData = readJson(path.join(dir, 'overrides.json'), { overrides: [] });
  const overrides = overridesData?.overrides ?? overridesData;
  assert(Array.isArray(overrides), 'overrides.json must contain an overrides array.');
  for (const item of overrides) {
    assert(item && isIsoDate(item.date) && typeof item.name === 'string' && item.name.trim(), 'Invalid holiday override.');
    assert(['national', 'collective_leave'].includes(item.type), `Invalid override type for ${item.date}`);
    for (const key of ['sourceUrl', 'reason', 'verifiedBy', 'verifiedAt']) assert(typeof item[key] === 'string' && item[key].trim(), `Override ${item.date} missing ${key}`);
    assert(/^https:\\/\\//i.test(item.sourceUrl), `Override ${item.date} must have an HTTPS source.`);
    holidays.set(item.date, { ...item, source: item.sourceUrl });
  }
  return { years, holidays };
}

export function getLatestVerifiedDate(rootDir = ROOT, startDate = null) {
  const { years } = loadHolidayData(rootDir);
  const config = readJson(path.join(rootDir, 'config', 'wfh.config.json'), {});
  const firstYear = Number(String(startDate ?? config.startDate ?? [...years.keys()][0]).slice(0, 4));
  if (!years.has(firstYear)) return null;
  let year = firstYear;
  while (years.has(year + 1)) year++;
  return `${year}-12-31`;
}

function eventWindow(scheme) {
  if (scheme === 'flexi') return { start: '08:30', end: '18:30', summary: 'Flexi 08:30–09:30 → +8h', description: 'Clock in 08:30–09:30 WIB · Clock out 8h after clock-in (latest 18:30 WIB) · Lunch 12:00–13:00 WIB. Calendar boundary intentionally uses the full 08:30–18:30 availability window.' };
  return { start: '08:30', end: '17:30', summary: 'Regular 08:30–17:30', description: 'Clock in 08:30 WIB · Clock out 17:30 WIB · Lunch 12:00–13:00 WIB.' };
}
function escapeText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function localDateTime(date, time) { return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`; }
function foldLine(line) {
  const chunks = []; let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) { chunks.push(current); current = ` ${char}`; }
    else current += char;
  }
  chunks.push(current); return chunks.join('\\r\\n');
}
function timezoneBlock() {
  return ['BEGIN:VTIMEZONE', 'TZID:Asia/Jakarta', 'X-LIC-LOCATION:Asia/Jakarta', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700', 'TZNAME:WIB', 'END:STANDARD', 'END:VTIMEZONE'];
}

export function makeCalendar(name, events, config) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//theAxels//wfh-calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${TZID}`, ...timezoneBlock()];
  for (const event of events) {
    const window = eventWindow(event.scheme);
    lines.push('BEGIN:VEVENT',
      `UID:${event.date}-${slug(event.name)}-${slug(event.team)}@theaxels.github.io`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\\d{3}/, '')}`,
      `DTSTART;TZID=${TZID}:${localDateTime(event.date, window.start)}`,
      `DTEND;TZID=${TZID}:${localDateTime(event.date, window.end)}`,
      `SUMMARY:${escapeText(`WFH — ${event.name} (${window.summary})`)}`,
      `DESCRIPTION:${escapeText(`${window.description} Team: ${event.team}. Holiday dates are skipped without advancing the team rotation.`)}`,
      `CATEGORIES:${escapeText(event.team)},WFH`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\\r\\n')}\\r\\n`;
}

function getRequestedEndDate(config) {
  if (config.endDateMode === 'rolling') {
    const ahead = Number(config.rollingYearsAhead ?? 5);
    assert(Number.isInteger(ahead) && ahead >= 1 && ahead <= 15, 'rollingYearsAhead must be from 1 to 15.');
    return `${new Date().getUTCFullYear() + ahead}-12-31`;
  }
  assert(isIsoDate(config.endDate) && config.endDate >= config.startDate, 'endDate must be valid and not before startDate.');
  return config.endDate;
}

export async function generateIcs(configPathOverride, outputDirOverride, rootDirOverride) {
  const rootDir = path.resolve(rootDirOverride ?? ROOT);
  const configPath = configPathOverride ? path.resolve(configPathOverride) : path.join(rootDir, 'config', 'wfh.config.json');
  const outputDir = outputDirOverride ? path.resolve(outputDirOverride) : path.join(rootDir, 'public', 'ics');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert(Array.isArray(config.teams) && config.teams.length > 0, 'teams must be a non-empty array.');
  assert(new Set(config.teams).size === config.teams.length, 'teams must be unique.');
  assert(Array.isArray(config.rotationOrder) && config.rotationOrder.length > 0, 'rotationOrder must be a non-empty array.');
  assert(config.rotationOrder.every(team => config.teams.includes(team)), 'rotationOrder contains an unknown team.');
  assert(config.rotationOrder.includes(config.startTeam), 'startTeam must be in rotationOrder.');
  assert(isIsoDate(config.startDate), 'startDate must be a valid YYYY-MM-DD date.');
  assert(Array.isArray(config.eligibleWeekdays) && config.eligibleWeekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6), 'eligibleWeekdays must contain weekday numbers.');

  const employeeFile = path.join(rootDir, 'data', 'employees.json');
  const employeeConfig = readJson(employeeFile, DEFAULT_EMPLOYEES);
  assert(Array.isArray(employeeConfig.employees), 'data/employees.json must contain employees array.');
  const defaultScheme = employeeConfig.defaultScheme ?? 'regular';
  const employees = employeeConfig.employees.map(employee => {
    const scheme = employee.scheme ?? (employee.flexi ? 'flexi' : defaultScheme);
    assert(typeof employee.name === 'string' && employee.name.trim(), 'Every employee must have a name.');
    assert(config.teams.includes(employee.team), `Employee ${employee.name} references unknown team ${employee.team}.`);
    assert(['regular', 'flexi'].includes(scheme), `Employee ${employee.name} has invalid scheme ${scheme}.`);
    return { ...employee, scheme };
  });

  const { years: holidayYears, holidays: holidayMap } = loadHolidayData(rootDir);
  const startYear = Number(config.startDate.slice(0, 4));
  assert(holidayYears.has(startYear), `Missing holiday cache for start year ${startYear}; refusing to publish.`);
  const requestedEndDate = getRequestedEndDate(config);
  const latestVerifiedDate = getLatestVerifiedDate(rootDir, config.startDate);
  assert(latestVerifiedDate, 'No consecutive verified holiday coverage from the configured start year.');
  const effectiveEndDate = requestedEndDate < latestVerifiedDate ? requestedEndDate : latestVerifiedDate;
  const start = new Date(`${config.startDate}T00:00:00.000Z`);
  const end = new Date(`${effectiveEndDate}T00:00:00.000Z`);
  const weekdays = new Set(config.eligibleWeekdays);
  const teamEvents = [];
  let rotationIndex = config.rotationOrder.indexOf(config.startTeam);
  for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const date = current.toISOString().slice(0, 10);
    if (!weekdays.has(current.getUTCDay())) continue;
    if (holidayMap.has(date)) continue; // Skip holidays without advancing rotation.
    teamEvents.push({ date, team: config.rotationOrder[rotationIndex] });
    rotationIndex = (rotationIndex + 1) % config.rotationOrder.length;
  }

  const events = teamEvents.flatMap(day => employees.filter(employee => employee.team === day.team).map(employee => ({ date: day.date, team: day.team, name: employee.name, scheme: employee.scheme })));
  fs.mkdirSync(outputDir, { recursive: true });
  const allName = `${config.calendarName} — All Teams`;
  const stableFiles = [{ team: 'All teams', file: 'all.ics', events: events.length }];
  fs.writeFileSync(path.join(outputDir, 'all.ics'), makeCalendar(allName, events, config));
  for (const team of config.teams) {
    const teamEvents = events.filter(event => event.team === team);
    const filename = `${slug(team)}.ics`;
    fs.writeFileSync(path.join(outputDir, filename), makeCalendar(`${config.calendarName} — ${team}`, teamEvents, config));
    stableFiles.push({ team, file: filename, events: teamEvents.length });
  }
  const firstYear = Number(config.startDate.slice(0, 4));
  const lastYear = Number(effectiveEndDate.slice(0, 4));
  const annualFeeds = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const annual = events.filter(event => Number(event.date.slice(0, 4)) === year);
    const combined = `${year}.ics`;
    fs.writeFileSync(path.join(outputDir, combined), makeCalendar(`${config.calendarName} ${year} — All Teams`, annual, config));
    for (const team of config.teams) {
      fs.writeFileSync(path.join(outputDir, `${slug(team)}-${year}.ics`), makeCalendar(`${config.calendarName} ${year} — ${team}`, annual.filter(event => event.team === team), config));
    }
    annualFeeds.push({ year, file: combined, events: annual.length });
  }
  for (const filename of fs.readdirSync(outputDir)) {
    const match = filename.match(/^(.*-)?(\\d{4})\\.ics$/);
    if (match && (Number(match[2]) < firstYear || Number(match[2]) > lastYear)) fs.rmSync(path.join(outputDir, filename), { force: true });
  }
  const status = readJson(path.join(rootDir, 'data', 'holidays', 'sync-status.json'), {});
  const manifest = {
    calendarName: config.calendarName, generatedAt: new Date().toISOString(),
    startDate: config.startDate, endDate: effectiveEndDate, requestedEndDate,
    timezone: TZID, totalEvents: events.length,
    stable: { combinedFile: 'all.ics', teams: stableFiles }, year: lastYear,
    combinedFile: 'all.ics', teams: stableFiles, annualFeeds,
    holidayCoverage: { requestedEndDate, coveredThrough: effectiveEndDate, latestVerifiedDate, capped: effectiveEndDate < requestedEndDate, lastCheck: status.lastCheck ?? null, lastSuccess: status.lastSuccess ?? null, availableYears: status.availableYears ?? [], pendingYears: status.pendingYears ?? [] },
    employees: employees.map(({ name, team, scheme }) => ({ name, team, scheme }))
  };
  fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\\n`);
  // Publish the exact status and scheme data consumed by the static website.
  const publicDataDir = path.join(path.dirname(outputDir), 'data');
  fs.mkdirSync(path.join(publicDataDir, 'holidays'), { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'data', 'holidays', 'sync-status.json'), path.join(publicDataDir, 'holidays', 'sync-status.json'));
  fs.copyFileSync(employeeFile, path.join(publicDataDir, 'employees.json'));
  return { events, startDate: config.startDate, endDate: effectiveEndDate, requestedEndDate, stableFiles, annualFeeds };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await generateIcs(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify({ status: 'generated', events: result.events.length, startDate: result.startDate, endDate: result.endDate, requestedEndDate: result.requestedEndDate, feeds: result.stableFiles.map(item => item.file) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
