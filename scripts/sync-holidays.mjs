import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOLIDAY_DIR = path.join(ROOT, 'data', 'holidays');
const BASE_URL = 'https://tanggalmerah.upset.dev';
const VALID_TYPES = new Set(['national', 'collective_leave', 'holiday', 'leave']);

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeHolidayType(input) {
  const value = String(input ?? '').trim().toLowerCase();
  if (value === 'holiday' || value === 'national') return 'national';
  if (value === 'leave' || value === 'collective_leave') return 'collective_leave';
  return null;
}

export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function listCachedYears() {
  ensureDirectory(HOLIDAY_DIR);
  return fs
    .readdirSync(HOLIDAY_DIR)
    .filter(file => /^\d{4}\.json$/.test(file))
    .map(file => Number(file.slice(0, 4)))
    .sort((a, b) => a - b);
}

export function loadOverrides() {
  const file = path.join(HOLIDAY_DIR, 'overrides.json');
  const data = readJson(file, []);
  if (!Array.isArray(data)) return [];
  return data.filter((item) => item && typeof item.date === 'string' && isIsoDate(item.date));
}

export function validateHolidayPayload(payload, requestedYear) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Holiday payload must be a JSON object.');
  }

  const envelope = payload.data ?? payload.holidays ?? payload;
  if (!Array.isArray(envelope)) {
    throw new Error(`Holiday response for ${requestedYear} did not contain a valid data array.`);
  }

  if (payload.year && Number(payload.year) !== requestedYear && payload.requestedYear && Number(payload.requestedYear) !== requestedYear) {
    const yearValue = Number(payload.year ?? payload.requestedYear);
    if (!Number.isNaN(yearValue) && yearValue !== requestedYear) {
      throw new Error(`API returned year ${yearValue} but was asked for ${requestedYear}.`);
    }
  }

  const seen = new Set();
  const normalized = [];

  for (const item of envelope) {
    if (!item || typeof item !== 'object') {
      throw new Error(`Holiday data for ${requestedYear} contains an invalid record.`);
    }

    const date = typeof item.date === 'string' ? item.date : typeof item?.tanggal === 'string' ? item.tanggal : null;
    const name = typeof item.name === 'string' ? item.name.trim() : typeof item?.holiday === 'string' ? item.holiday.trim() : '';
    const rawType = normalizeHolidayType(item.type ?? item.category ?? item.holidayType ?? item.kind);

    if (!isIsoDate(date) || Number(date.slice(0, 4)) !== requestedYear) {
      throw new Error(`Holiday date ${date ?? 'missing'} is not in year ${requestedYear}.`);
    }

    if (!name) {
      throw new Error(`Holiday entry for ${date} is missing a valid name.`);
    }

    if (!rawType || !VALID_TYPES.has(rawType)) {
      throw new Error(`Holiday entry for ${date} has an unsupported type: ${item.type ?? 'unknown'}.`);
    }

    if (seen.has(date)) {
      throw new Error(`Duplicate holiday date found: ${date}.`);
    }
    seen.add(date);

    normalized.push({ date, name, type: rawType });
  }

  if (normalized.length < 10) {
    throw new Error(`Holiday dataset for ${requestedYear} has only ${normalized.length} entries; expected at least 10.`);
  }

  return normalized;
}

async function fetchJson(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const payload = await response.json();
  return payload;
}

export async function discoverAvailableYears(baseUrl = BASE_URL, timeoutMs = 10000) {
  const payload = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/api/years`, timeoutMs);
  if (!Array.isArray(payload?.data)) {
    throw new Error('The Tanggal Merah API did not return a valid /api/years response.');
  }

  const years = payload.data
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year));

  if (years.length === 0) {
    throw new Error('No available years were returned by the Tanggal Merah API.');
  }

  return [...new Set(years)].sort((a, b) => a - b);
}

export async function syncYear(year, { baseUrl = BASE_URL, timeoutMs = 10000, dryRun = false, force = false, rootDir = ROOT } = {}) {
  const yearPath = path.join(HOLIDAY_DIR, `${year}.json`);
  const known = readJson(yearPath, null);
  const shouldSkip = !force && known && Array.isArray(known.holidays) && known.holidays.length >= 10;
  if (shouldSkip) {
    return { year, status: 'cached', changed: false, file: yearPath };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/holidays?year=${year}`;
  const payload = await fetchJson(url, timeoutMs);
  const holidays = validateHolidayPayload(payload, year);
  const record = {
    source: url,
    fetchedAt: new Date().toISOString(),
    year,
    holidays
  };

  if (!dryRun) {
    ensureDirectory(HOLIDAY_DIR);
    fs.writeFileSync(yearPath, `${JSON.stringify(record, null, 2)}\n`);
  }

  return { year, status: 'updated', changed: !dryRun, file: yearPath, holidays };
}

export async function syncHolidays(options = {}) {
  const {
    baseUrl = BASE_URL,
    timeoutMs = 10000,
    dryRun = false,
    year = null,
    force = false,
    rootDir = ROOT
  } = options;

  const errors = [];
  const summary = {
    dryRun,
    requestedYear: year,
    availableYears: [],
    cachedYears: listCachedYears(),
    updatedYears: [],
    verifiedThrough: null,
    lastSuccess: null,
    lastCheck: new Date().toISOString(),
    errors
  };

  let yearsToSync = [];
  try {
    const availableYears = await discoverAvailableYears(baseUrl, timeoutMs);
    summary.availableYears = availableYears;

    if (year) {
      yearsToSync = availableYears.includes(Number(year)) ? [Number(year)] : [Number(year)];
    } else {
      const cached = new Set(listCachedYears());
      yearsToSync = availableYears.filter((entry) => force || !cached.has(entry));
    }

    for (const targetYear of yearsToSync) {
      try {
        const result = await syncYear(targetYear, { baseUrl, timeoutMs, dryRun, force, rootDir });
        if (result.changed) summary.updatedYears.push(targetYear);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ year: targetYear, message });
      }
    }

    const localYears = listCachedYears();
    if (localYears.length > 0) {
      summary.verifiedThrough = `${Math.max(...localYears)}-12-31`;
      summary.lastSuccess = new Date().toISOString();
    }
    const overrides = loadOverrides();
    if (!dryRun && overrides.length > 0) {
      const overrideMap = new Map();
      for (const item of overrides) {
        overrideMap.set(item.date, item);
      }
      for (const year of localYears) {
        const file = path.join(HOLIDAY_DIR, `${year}.json`);
        const record = readJson(file, null);
        if (!record || !Array.isArray(record.holidays)) continue;
        const byDate = new Map(record.holidays.map((holiday) => [holiday.date, holiday]));
        for (const [date, override] of overrideMap.entries()) {
          if (date.startsWith(`${year}-`)) {
            byDate.set(date, {
              date,
              name: override.name,
              type: normalizeHolidayType(override.type) ?? 'national',
              source: override.sourceUrl,
              verifiedBy: override.verifiedBy,
              verifiedAt: override.verifiedAt
            });
          }
        }
        record.holidays = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
      }
    }

    const statusFile = path.join(HOLIDAY_DIR, 'sync-status.json');
    const statusRecord = {
      lastCheck: summary.lastCheck,
      lastSuccess: summary.lastSuccess,
      availableYears: summary.availableYears,
      verifiedThrough: summary.verifiedThrough,
      errors: summary.errors,
      coverage: summary.verifiedThrough ? summary.verifiedThrough.slice(0, 4) : null,
      status: summary.errors.length === 0 ? 'verified' : 'error'
    };

    if (!dryRun) {
      fs.writeFileSync(statusFile, `${JSON.stringify(statusRecord, null, 2)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ year: year ?? null, message });
    summary.errors = errors;
    summary.verifiedThrough = summary.verifiedThrough ?? null;
    summary.lastSuccess = summary.lastSuccess ?? null;
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const force = args.has('--force');
  const yearArg = [...args].find((arg) => /^--year=\d{4}$/.test(arg));
  const year = yearArg ? Number(yearArg.split('=')[1]) : null;

  try {
    await syncHolidays({ dryRun, force, year });
    if (year && !dryRun && force) {
      console.log(`Manual sync for ${year} completed.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
