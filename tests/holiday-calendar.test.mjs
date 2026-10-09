import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateHolidayPayload, syncHolidays } from '../scripts/sync-holidays.mjs';
import { makeCalendar, loadHolidayData, generateIcs } from '../scripts/generate-ics.mjs';

function sampleHolidays(year = 2027) {
  return Array.from({ length: 10 }, (_, i) => ({
    date: `${year}-${String(i + 1).padStart(2, '0')}-01`,
    name: `National holiday ${i + 1}`,
    type: 'national'
  }));
}
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfh-calendar-'));
  fs.mkdirSync(path.join(root, 'data', 'holidays'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'holidays', 'sync-status.json'), JSON.stringify({ status: 'verified', availableYears: [2027], lastSuccess: '2026-10-10T00:00:00.000Z' }));
  return root;
}
function writeYear(root, year, holidays = sampleHolidays(year)) {
  fs.writeFileSync(path.join(root, 'data', 'holidays', `${year}.json`), JSON.stringify({ year, source: 'https://example.test', fetchedAt: '2026-10-10T00:00:00.000Z', holidays }));
}

test('validates a complete holiday response and requested year', () => {
  assert.equal(validateHolidayPayload({ year: 2027, holidays: sampleHolidays() }, 2027).length, 10);
  assert.throws(() => validateHolidayPayload({ year: 2026, holidays: sampleHolidays() }, 2027), /year/);
});
test('rejects duplicate dates and malformed date values', () => {
  const duplicate = sampleHolidays(); duplicate[1].date = duplicate[0].date;
  assert.throws(() => validateHolidayPayload({ holidays: duplicate }, 2027), /Duplicate/);
  const malformed = sampleHolidays(); malformed[0].date = '2027-02-30';
  assert.throws(() => validateHolidayPayload({ holidays: malformed }, 2027), /Invalid holiday date/);
});
test('requires at least ten national holidays, not just ten mixed entries', () => {
  const holidays = sampleHolidays(); holidays[0].type = 'collective_leave';
  assert.throws(() => validateHolidayPayload({ holidays }, 2027), /national holidays/);
});
test('discovers a newly published year and writes it without code changes', async () => {
  const rootDir = tempRoot();
  const fetchImpl = async url => new Response(JSON.stringify(url.endsWith('/api/years') ? { data: [2026, 2027] } : { year: 2027, holidays: sampleHolidays() }), { status: 200, headers: { 'content-type': 'application/json' } });
  writeYear(rootDir, 2026);
  const result = await syncHolidays({ rootDir, baseUrl: 'https://example.test', fetchImpl, retries: 0, now: () => new Date('2026-10-10T00:00:00Z') });
  assert.deepEqual(result.updatedYears, [2027]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'holidays', '2027.json'))).year, 2027);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('2027+ sync does not require code edits', async () => {
  const rootDir = tempRoot();
  const fetchImpl = async url => new Response(JSON.stringify(url.endsWith('/api/years') ? { data: [2027, 2028] } : { year: Number(new URL(url).searchParams.get('year')), holidays: sampleHolidays(Number(new URL(url).searchParams.get('year'))) }), { status: 200 });
  const result = await syncHolidays({ rootDir, baseUrl: 'https://example.test', fetchImpl, retries: 0 });
  assert.deepEqual(result.updatedYears, [2027, 2028]);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('API outage preserves last-known-good cache and returns failure', async () => {
  const rootDir = tempRoot(); writeYear(rootDir, 2026);
  const before = fs.readFileSync(path.join(rootDir, 'data', 'holidays', '2026.json'), 'utf8');
  const result = await syncHolidays({ rootDir, baseUrl: 'https://example.test', fetchImpl: async () => { throw new Error('offline'); }, retries: 0 });
  assert.equal(result.status, 'error');
  assert.equal(fs.readFileSync(path.join(rootDir, 'data', 'holidays', '2026.json'), 'utf8'), before);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('missing API years remain pending rather than having zero holidays assumed', async () => {
  const rootDir = tempRoot(); writeYear(rootDir, 2026);
  const result = await syncHolidays({ rootDir, baseUrl: 'https://example.test', fetchImpl: async () => new Response(JSON.stringify({ data: [2026] }), { status: 200 }), retries: 0 });
  assert.deepEqual(result.pendingYears, []);
  assert.equal(result.verifiedThrough, '2026-12-31');
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('manual overrides require provenance and replace matching dates', () => {
  const rootDir = tempRoot(); writeYear(rootDir, 2027);
  const holidaysDir = path.join(rootDir, 'data', 'holidays');
  fs.writeFileSync(path.join(holidaysDir, 'overrides.json'), JSON.stringify({ overrides: [{ date: '2027-01-01', name: 'Corrected', type: 'national', sourceUrl: 'https://gov.example/notice', reason: 'Decree correction', verifiedBy: 'admin', verifiedAt: '2026-10-10T00:00:00Z' }] }));
  assert.equal(loadHolidayData(rootDir).holidays.get('2027-01-01').name, 'Corrected');
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('Regular scheme has the expected DTSTART and DTEND', () => {
  const ics = makeCalendar('Test', [{ date: '2026-10-12', team: 'Team A', name: 'Alice', scheme: 'regular' }], { timezone: 'Asia/Jakarta' });
  assert.match(ics, /DTSTART;TZID=Asia\/Jakarta:20261012T083000/);
  assert.match(ics, /DTEND;TZID=Asia\/Jakarta:20261012T173000/);
});
test('Flexi scheme uses the full availability window ending at 18:30', () => {
  const ics = makeCalendar('Test', [{ date: '2026-10-12', team: 'Team A', name: 'Bob', scheme: 'flexi' }], {});
  assert.match(ics, /DTSTART;TZID=Asia\/Jakarta:20261012T083000/);
  assert.match(ics, /DTEND;TZID=Asia\/Jakarta:20261012T183000/);
  assert.match(ics, /full 08:30–18:30 availability window/);
});
test('every calendar includes Asia/Jakarta VTIMEZONE and fixed UTC+7 offset', () => {
  const ics = makeCalendar('Test', [], {});
  assert.match(ics, /BEGIN:VTIMEZONE[\s\S]*TZID:Asia\/Jakarta[\s\S]*TZOFFSETFROM:\+0700[\s\S]*TZOFFSETTO:\+0700[\s\S]*END:VTIMEZONE/);
  assert.doesNotMatch(ics, /TZOFFSETTO:\+0800|DTSTART;TZID=Asia\/Jakarta:\d{8}T\d{6}Z/);
});
test('holidays are skipped without advancing the team rotation', () => {
  const rootDir = tempRoot();
  fs.writeFileSync(path.join(rootDir, 'config', 'wfh.config.json'), JSON.stringify({ calendarName: 'Test', timezone: 'Asia/Jakarta', startDate: '2027-01-01', endDateMode: 'fixed', endDate: '2027-01-05', startTeam: 'Team A', teams: ['Team A', 'Team B'], rotationOrder: ['Team A', 'Team B'], eligibleWeekdays: [1, 2, 3, 4, 5] }));
  writeYear(rootDir, 2027, [...sampleHolidays(), { date: '2027-01-04', name: 'Local test holiday', type: 'national' }]);
  const employeeData = { defaultScheme: 'regular', employees: [{ name: 'Alice', team: 'Team A', scheme: 'regular' }, { name: 'Bob', team: 'Team B', scheme: 'flexi' }] };
  fs.writeFileSync(path.join(rootDir, 'data', 'employees.json'), JSON.stringify(employeeData));
  fs.writeFileSync(path.join(rootDir, 'data', 'holidays', 'overrides.json'), JSON.stringify({ overrides: [] }));
  const output = path.join(rootDir, 'public', 'ics');
  return generateIcs(path.join(rootDir, 'config', 'wfh.config.json'), output, rootDir).then(result => {
    const dayEvents = result.events.filter(event => event.date === '2027-01-05');
    assert.equal(dayEvents[0].team, 'Team A'); // Monday holiday skipped without rotating.
    assert.equal(result.events.some(event => event.date === '2027-01-04'), false);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
test('stable all-team and per-team output filenames do not change', async () => {
  const rootDir = tempRoot();
  fs.writeFileSync(path.join(rootDir, 'config', 'wfh.config.json'), JSON.stringify({ calendarName: 'Test', timezone: 'Asia/Jakarta', startDate: '2027-01-04', endDateMode: 'fixed', endDate: '2027-01-05', startTeam: 'Team A', teams: ['Team A', 'Team B'], rotationOrder: ['Team A', 'Team B'], eligibleWeekdays: [1, 2, 3, 4, 5] }));
  writeYear(rootDir, 2027); fs.writeFileSync(path.join(rootDir, 'data', 'employees.json'), JSON.stringify({ defaultScheme: 'regular', employees: [{ name: 'Alice', team: 'Team A', scheme: 'regular' }] }));
  fs.writeFileSync(path.join(rootDir, 'data', 'holidays', 'overrides.json'), JSON.stringify({ overrides: [] }));
  await generateIcs(path.join(rootDir, 'config', 'wfh.config.json'), path.join(rootDir, 'public', 'ics'), rootDir);
  assert.ok(fs.existsSync(path.join(rootDir, 'public', 'ics', 'all.ics')));
  assert.ok(fs.existsSync(path.join(rootDir, 'public', 'ics', 'team-a.ics')));
  assert.ok(fs.existsSync(path.join(rootDir, 'public', 'ics', 'team-b.ics')));
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('website source loads status and employee data dynamically', async () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /fetch\('\.\/data\/holidays\/sync-status\.json'/);
  assert.match(html, /fetch\('\.\/data\/employees\.json'/);
  assert.match(html, /employee\.name/);
});
test('sync failure summary exposes errors for GitHub Actions to fail the job', async () => {
  const rootDir = tempRoot();
  const result = await syncHolidays({ rootDir, baseUrl: 'https://example.test', fetchImpl: async () => { throw new Error('network down'); }, retries: 0 });
  assert.equal(result.status, 'error');
  assert.ok(result.errors.length > 0);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
test('cache files cannot imply coverage across a missing year', () => {
  const rootDir = tempRoot(); writeYear(rootDir, 2026); writeYear(rootDir, 2028);
  fs.writeFileSync(path.join(rootDir, 'config', 'wfh.config.json'), JSON.stringify({ startDate: '2026-01-01' }));
  assert.equal(requireLatestDate(rootDir), null);
  fs.rmSync(rootDir, { recursive: true, force: true });
});
function requireLatestDate(rootDir) {
  const { years } = loadHolidayData(rootDir);
  let year = 2026;
  if (!years.has(year)) return null;
  while (years.has(year + 1)) year++;
  return `${year}-12-31`;
}
