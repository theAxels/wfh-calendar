import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateHolidayPayload } from '../scripts/sync-holidays.mjs';
import { makeCalendar, generateIcs } from '../scripts/generate-ics.mjs';

test('validateHolidayPayload accepts a complete year payload', () => {
  const payload = {
    data: [
      { date: '2026-01-01', name: 'New Year', type: 'holiday' },
      { date: '2026-02-07', name: 'Isra Mi\'raj', type: 'holiday' },
      { date: '2026-03-17', name: 'Nyepi', type: 'holiday' },
      { date: '2026-04-01', name: 'Good Friday', type: 'holiday' },
      { date: '2026-05-01', name: 'Labour Day', type: 'holiday' },
      { date: '2026-05-14', name: 'Ascension', type: 'holiday' },
      { date: '2026-06-01', name: 'Pancasila Day', type: 'holiday' },
      { date: '2026-06-26', name: 'Eid al-Adha', type: 'holiday' },
      { date: '2026-08-17', name: 'Independence Day', type: 'holiday' },
      { date: '2026-12-25', name: 'Christmas', type: 'holiday' },
      { date: '2026-03-20', name: 'Joint leave', type: 'leave' }
    ]
  };

  const result = validateHolidayPayload(payload, 2026);
  assert.equal(result.length, 11);
  assert.equal(result[0].type, 'national');
});

test('validateHolidayPayload rejects duplicate dates', () => {
  const payload = {
    data: [
      { date: '2026-01-01', name: 'New Year', type: 'holiday' },
      { date: '2026-01-01', name: 'Duplicate', type: 'holiday' }
    ]
  };

  assert.throws(() => validateHolidayPayload(payload, 2026), /Duplicate holiday date found/);
});

test('Calendar generation includes VTIMEZONE and correct regular window', () => {
  const calendar = makeCalendar('WFH Calendar', [{ date: '2026-10-09', team: 'Team A' }], { timezone: 'Asia/Jakarta' }, 'regular');
  assert.match(calendar, /BEGIN:VTIMEZONE/);
  assert.match(calendar, /TZID:Asia\/Jakarta/);
  assert.match(calendar, /DTSTART;TZID=Asia\/Jakarta:20261009T083000/);
  assert.match(calendar, /DTEND;TZID=Asia\/Jakarta:20261009T173000/);
});

test('Flexi events use the full working window', () => {
  const calendar = makeCalendar('WFH Calendar', [{ date: '2026-10-09', team: 'Team C' }], { timezone: 'Asia/Jakarta' }, 'flexi');
  assert.match(calendar, /DTEND;TZID=Asia\/Jakarta:20261009T183000/);
  assert.match(calendar, /Clock in 08:30–09:30 WIB/);
});

test('generateIcs creates the stable feed files', async () => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-ics-'));
  try {
    const result = await generateIcs('config/wfh.config.json', tempDir);
    assert.ok(result.stableFiles.some(file => file.file === 'all.ics'));
    assert.ok(fs.existsSync(path.join(tempDir, 'all.ics')));
    assert.ok(fs.existsSync(path.join(tempDir, 'team-a.ics')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
