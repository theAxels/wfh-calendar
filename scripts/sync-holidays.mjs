import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE_URL = 'https://tanggalmerah.upset.dev';
const VALID_TYPES = new Set(['national', 'collective_leave']);

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeHolidayType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (['national', 'holiday'].includes(type)) return 'national';
  if (['collective_leave', 'collective-leave', 'leave'].includes(type)) return 'collective_leave';
  return null;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\\n`);
}
function cachedYears(rootDir) {
  const dir = path.join(rootDir, 'data', 'holidays');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^\\d{4}\\.json$/.test(f)).map(f => Number(f.slice(0, 4))).sort((a, b) => a - b);
}

export function validateHolidayPayload(payload, year) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Holiday response must be a JSON object.');
  const responseYear = payload.year ?? payload.requestedYear ?? payload.data?.year;
  if (responseYear != null && Number(responseYear) !== year) throw new Error(`API returned year ${responseYear}, requested ${year}.`);
  const entries = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.holidays) ? payload.holidays : Array.isArray(payload.data?.holidays) ? payload.data.holidays : null;
  if (!entries) throw new Error('Holiday response has no expected data/holidays array.');
  const dates = new Set();
  const normalized = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Holiday response contains a malformed record.');
    const date = item.date ?? item.tanggal;
    const name = typeof item.name === 'string' ? item.name.trim() : typeof item.holiday === 'string' ? item.holiday.trim() : '';
    const type = normalizeHolidayType(item.type ?? item.category ?? item.holidayType ?? item.kind);
    if (!isIsoDate(date) || Number(date.slice(0, 4)) !== year) throw new Error(`Invalid holiday date for ${year}: ${String(date)}.`);
    if (!name) throw new Error(`Holiday ${date} has no name.`);
    if (!type || !VALID_TYPES.has(type)) throw new Error(`Holiday ${date} has unsupported type: ${String(item.type ?? item.category ?? 'missing')}.`);
    if (dates.has(date)) throw new Error(`Duplicate holiday date: ${date}.`);
    dates.add(date);
    normalized.push({ date, name, type });
  }
  const nationalCount = normalized.filter(item => item.type === 'national').length;
  if (nationalCount < 10) throw new Error(`Year ${year} has only ${nationalCount} national holidays; minimum is 10.`);
  return normalized.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchJson(url, { timeoutMs = 12000, retries = 3, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw new Error(`Request failed after ${retries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function discoverAvailableYears(baseUrl = DEFAULT_BASE_URL, options = {}) {
  const payload = await fetchJson(`${baseUrl.replace(/\\/+$/, '')}/api/years`, options);
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.years) ? payload.years : null;
  if (!raw) throw new Error('/api/years response has no year array.');
  const years = raw.map(value => Number(typeof value === 'object' ? value.year : value));
  if (years.some(year => !Number.isInteger(year) || year < 2000 || year > 2200)) throw new Error('/api/years contains an invalid year.');
  const unique = [...new Set(years)].sort((a, b) => a - b);
  if (!unique.length) throw new Error('/api/years returned no available years.');
  return unique;
}

function applyOverrides(holidays, overrides, year) {
  const byDate = new Map(holidays.map(item => [item.date, item]));
  for (const item of overrides) {
    if (!item || !isIsoDate(item.date) || Number(item.date.slice(0, 4)) !== year) continue;
    const required = ['name', 'sourceUrl', 'reason', 'verifiedBy', 'verifiedAt'];
    if (required.some(key => typeof item[key] !== 'string' || !item[key].trim())) throw new Error(`Override ${item.date} is missing required provenance fields.`);
    if (!/^https:\\/\\//i.test(item.sourceUrl)) throw new Error(`Override ${item.date} sourceUrl must be HTTPS.`);
    if (!isIsoDate(item.date) || !Number.isFinite(Date.parse(item.verifiedAt))) throw new Error(`Override ${item.date} has invalid date metadata.`);
    const type = normalizeHolidayType(item.type);
    if (!type) throw new Error(`Override ${item.date} has invalid type.`);
    byDate.set(item.date, { date: item.date, name: item.name.trim(), type, source: item.sourceUrl, reason: item.reason, verifiedBy: item.verifiedBy, verifiedAt: item.verifiedAt });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function syncHolidays(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? ROOT);
  const holidayDir = path.join(rootDir, 'data', 'holidays');
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const requestedYear = options.year == null ? null : Number(options.year);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const errors = [];
  const summary = { dryRun, requestedYear, lastCheck: now, lastSuccess: null, availableYears: [], cachedYears: cachedYears(rootDir), updatedYears: [], verifiedThrough: null, pendingYears: [], errors: [] };
  let discovered = false;

  try {
    summary.availableYears = requestedYear == null
      ? await discoverAvailableYears(baseUrl, options)
      : (await discoverAvailableYears(baseUrl, options)).filter(y => y === requestedYear);
    discovered = true;
    if (requestedYear != null && !Number.isInteger(requestedYear)) throw new Error('--year must be a four-digit year.');
    const targets = requestedYear != null
      ? (summary.availableYears.includes(requestedYear) ? [requestedYear] : [])
      : summary.availableYears.filter(year => force || !summary.cachedYears.includes(year));
    if (requestedYear != null && targets.length === 0) throw new Error(`Year ${requestedYear} is not currently listed by the API (pending publication).`);

    const overridesFile = path.join(holidayDir, 'overrides.json');
    const overridesData = readJson(overridesFile, { overrides: [] });
    if (!overridesData || !Array.isArray(overridesData.overrides ?? (Array.isArray(overridesData) ? overridesData : null))) throw new Error('overrides.json must contain an overrides array.');
    const overrides = overridesData.overrides ?? overridesData;

    for (const year of targets) {
      try {
        const targetFile = path.join(holidayDir, `${year}.json`);
        const existing = readJson(targetFile);
        if (!force && existing?.year === year && Array.isArray(existing.holidays)) {
          validateHolidayPayload({ year, holidays: existing.holidays }, year);
          continue;
        }
        const url = `${baseUrl.replace(/\\/+$/, '')}/api/holidays?year=${year}`;
        const payload = await fetchJson(url, options);
        const holidays = applyOverrides(validateHolidayPayload(payload, year), overrides, year);
        const record = { source: url, fetchedAt: now, year, holidays };
        if (!dryRun) writeJson(targetFile, record);
        summary.updatedYears.push(year);
      } catch (error) {
        errors.push({ year, message: error instanceof Error ? error.message : String(error) });
      }
    }

    // Apply documented overrides to already-cached years, without rewriting data during dry runs.
    if (!dryRun) {
      for (const year of cachedYears(rootDir)) {
        const file = path.join(holidayDir, `${year}.json`);
        const record = readJson(file);
        if (!record || !Array.isArray(record.holidays)) continue;
        const next = applyOverrides(record.holidays, overrides, year);
        if (JSON.stringify(next) !== JSON.stringify(record.holidays)) writeJson(file, { ...record, holidays: next });
      }
    }

    const local = cachedYears(rootDir);
    let consecutive = null;
    if (local.length) {
      consecutive = local[0];
      while (local.includes(consecutive + 1)) consecutive++;
      // Only report a verified-through date if the cache begins at the configured calendar start year.
      const config = readJson(path.join(rootDir, 'config', 'wfh.config.json'), {});
      const startYear = Number(String(config.startDate ?? local[0]).slice(0, 4));
      if (local.includes(startYear)) {
        consecutive = startYear;
        while (local.includes(consecutive + 1)) consecutive++;
        summary.verifiedThrough = `${consecutive}-12-31`;
      }
    }
    summary.pendingYears = summary.availableYears.filter(year => !local.includes(year));
    if (consecutive != null && !summary.availableYears.includes(consecutive + 1) && !summary.pendingYears.includes(consecutive + 1)) {
      summary.pendingYears.push(consecutive + 1);
    }
    summary.pendingYears.sort((a, b) => a - b);
    if (errors.length === 0 && discovered) summary.lastSuccess = now;
  } catch (error) {
    errors.push({ year: requestedYear, message: error instanceof Error ? error.message : String(error) });
  }

  summary.errors = errors;
  const statusFile = path.join(holidayDir, 'sync-status.json');
  const previous = readJson(statusFile, {});
  const status = {
    lastCheck: now,
    lastSuccess: summary.lastSuccess ?? previous.lastSuccess ?? null,
    availableYears: summary.availableYears.length ? summary.availableYears : (previous.availableYears ?? []),
    verifiedThrough: summary.verifiedThrough ?? previous.verifiedThrough ?? null,
    pendingYears: summary.pendingYears,
    errors,
    status: errors.length ? 'error' : 'verified',
    source: baseUrl
  };
  if (!dryRun) writeJson(statusFile, status);
  console.log(JSON.stringify({ ...summary, status: status.status }, null, 2));
  return { ...summary, status: status.status };
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const yearArg = args.find(arg => /^--year=\\d{4}$/.test(arg));
  try {
    const result = await syncHolidays({ dryRun: args.includes('--dry-run'), force: args.includes('--force'), year: yearArg ? Number(yearArg.split('=')[1]) : null });
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
