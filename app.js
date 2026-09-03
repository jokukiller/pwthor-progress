const MAX_COUNT = 1_000_000_000_000;
const MAX_RATE = 10_000_000;
const MAX_SECONDS = 315_576_000;
export const STALE_AFTER_MS = 5 * 60 * 1000;

const ROOT_KEYS = ['schemaVersion', 'generatedAt', 'serviceVersion', 'catalogue', 'proxies', 'rates', 'eta', 'backup', 'runtime'];
const SHAPES = {
  catalogue: ['totalBatches', 'verifiedCompleteBatches', 'leasedBatches', 'pendingBatches', 'revalidationRemaining', 'completePages', 'pendingPages', 'historicalSeedSchedules', 'historicalSeedPlacements', 'uniqueSchedules', 'placements'],
  proxies: ['qualifiedGuest', 'qualifiedAccount', 'activeLeases'],
  rates: ['batchesPerHour', 'schedulesPerHour', 'windowHours'],
  eta: ['status', 'seconds', 'projectedAt', 'confidence'],
  backup: ['status', 'lastVerifiedAt', 'ageSeconds', 'redundancy', 'verificationMode'],
  runtime: ['uptimeSeconds', 'restarts'],
};

function exactObject(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${path} has unexpected or missing keys`);
  }
}

function integer(value, path, max = MAX_COUNT) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`${path} is out of range`);
  return value;
}

function number(value, path, max = MAX_RATE) {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`${path} is out of range`);
  return value;
}

function timestamp(value, path, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new TypeError(`${path} must be an ISO UTC timestamp`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${path} is invalid`);
  return date.toISOString();
}

function oneOf(value, choices, path) {
  if (!choices.includes(value)) throw new TypeError(`${path} is invalid`);
  return value;
}

export function sanitizeStatus(input, now = Date.now()) {
  exactObject(input, ROOT_KEYS, 'status');
  for (const [key, keys] of Object.entries(SHAPES)) exactObject(input[key], keys, key);
  if (input.schemaVersion !== 2) throw new TypeError('schemaVersion must be 2');
  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  const generatedMs = Date.parse(generatedAt);
  if (generatedMs > now + 300_000 || generatedMs < now - 31_557_600_000) throw new RangeError('generatedAt is unreasonable');
  if (typeof input.serviceVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(input.serviceVersion)) throw new TypeError('serviceVersion is invalid');

  const catalogue = Object.fromEntries(SHAPES.catalogue.map((key) => [key, integer(input.catalogue[key], `catalogue.${key}`)]));
  if (catalogue.verifiedCompleteBatches + catalogue.leasedBatches + catalogue.pendingBatches !== catalogue.totalBatches || catalogue.revalidationRemaining !== catalogue.totalBatches - catalogue.verifiedCompleteBatches) throw new RangeError('batch counts must reconcile');
  const proxies = Object.fromEntries(SHAPES.proxies.map((key) => [key, integer(input.proxies[key], `proxies.${key}`)]));
  const rates = {
    batchesPerHour: number(input.rates.batchesPerHour, 'rates.batchesPerHour'),
    schedulesPerHour: number(input.rates.schedulesPerHour, 'rates.schedulesPerHour'),
    windowHours: number(input.rates.windowHours, 'rates.windowHours', 168),
  };
  if (rates.windowHours === 0) throw new RangeError('rates.windowHours must be positive');

  const eta = {
    status: oneOf(input.eta.status, ['available', 'calculating', 'complete', 'unavailable'], 'eta.status'),
    seconds: input.eta.seconds === null ? null : integer(input.eta.seconds, 'eta.seconds', MAX_SECONDS),
    projectedAt: timestamp(input.eta.projectedAt, 'eta.projectedAt', true),
    confidence: oneOf(input.eta.confidence, ['low', 'medium', 'high', 'unknown'], 'eta.confidence'),
  };
  if (eta.status === 'available' && (eta.seconds === null || eta.projectedAt === null)) throw new TypeError('available ETA requires seconds and projectedAt');
  if (eta.status === 'complete' && eta.seconds !== 0) throw new TypeError('complete ETA requires zero seconds');

  const backup = {
    status: oneOf(input.backup.status, ['healthy', 'stale', 'failed', 'unknown'], 'backup.status'),
    lastVerifiedAt: timestamp(input.backup.lastVerifiedAt, 'backup.lastVerifiedAt', true),
    ageSeconds: input.backup.ageSeconds === null ? null : integer(input.backup.ageSeconds, 'backup.ageSeconds', MAX_SECONDS),
    redundancy: integer(input.backup.redundancy, 'backup.redundancy', 16),
    verificationMode: oneOf(input.backup.verificationMode, ['full-restore', 'inventory', 'none'], 'backup.verificationMode'),
  };
  if (backup.status === 'healthy' && backup.redundancy < 1) throw new RangeError('healthy backup requires at least one verified destination');
  const runtime = {
    uptimeSeconds: integer(input.runtime.uptimeSeconds, 'runtime.uptimeSeconds', MAX_SECONDS),
    restarts: integer(input.runtime.restarts, 'runtime.restarts', 1_000_000),
  };
  return { schemaVersion: 2, generatedAt, serviceVersion: input.serviceVersion, catalogue, proxies, rates, eta, backup, runtime };
}

export function deriveConnectionState(status, now = Date.now(), offline = false) {
  if (offline) return { kind: 'offline', label: 'Offline · showing last known data' };
  if (!status) return { kind: 'loading', label: 'Loading' };
  if (now - Date.parse(status.generatedAt) > STALE_AFTER_MS) return { kind: 'stale', label: 'Stale data' };
  return { kind: 'current', label: 'Current' };
}

export function formatEta(eta) {
  if (eta.status === 'complete') return 'Complete';
  if (eta.status === 'calculating') return 'Calculating';
  if (eta.status === 'unavailable') return 'Unavailable';
  const hours = Math.floor(eta.seconds / 3600);
  const minutes = Math.round((eta.seconds % 3600) / 60);
  return `${hours ? `${hours}h ` : ''}${minutes}m · ${new Date(eta.projectedAt).toLocaleString()}`;
}

const formatNumber = new Intl.NumberFormat();
const byId = (id) => document.getElementById(id);
let latest = null;
let fetchFailed = false;

function setText(id, value) { byId(id).textContent = value; }
function renderConnection() {
  const state = deriveConnectionState(latest, Date.now(), fetchFailed);
  const node = byId('connection');
  node.className = `state ${state.kind}`;
  node.textContent = state.label;
}

function render(status) {
  latest = status;
  const c = status.catalogue;
  const percent = c.totalBatches === 0 ? 0 : (c.verifiedCompleteBatches / c.totalBatches) * 100;
  byId('progress').value = percent;
  byId('progress').textContent = `${percent.toFixed(1)}%`;
  setText('progress-percent', `${percent.toFixed(1)}%`);
  setText('progress-detail', `${formatNumber.format(c.verifiedCompleteBatches)} of ${formatNumber.format(c.totalBatches)} batches verified`);
  for (const [id, value] of [['complete-batches', c.verifiedCompleteBatches], ['pending-batches', c.pendingBatches], ['leased-batches', c.leasedBatches], ['revalidation-remaining', c.revalidationRemaining], ['complete-pages', c.completePages], ['pending-pages', c.pendingPages], ['historical-seed-schedules', c.historicalSeedSchedules], ['historical-seed-placements', c.historicalSeedPlacements], ['unique-schedules', c.uniqueSchedules], ['placements', c.placements]]) setText(id, formatNumber.format(value));
  setText('batch-rate', formatNumber.format(status.rates.batchesPerHour));
  setText('schedule-rate', formatNumber.format(status.rates.schedulesPerHour));
  setText('rate-window', `${status.rates.windowHours}h`);
  setText('eta', formatEta(status.eta));
  setText('eta-confidence', status.eta.confidence);
  setText('backup', status.backup.ageSeconds === null ? status.backup.status : `${status.backup.status} · ${Math.floor(status.backup.ageSeconds / 60)}m ago · x${status.backup.redundancy} ${status.backup.verificationMode}`);
  setText('qualified-proxies', formatNumber.format(status.proxies.qualifiedGuest + status.proxies.qualifiedAccount));
  setText('active-leases', formatNumber.format(status.proxies.activeLeases));
  const updated = byId('last-update');
  updated.dateTime = status.generatedAt;
  updated.textContent = new Date(status.generatedAt).toLocaleString();
  setText('version', `Service version: ${status.serviceVersion}`);
  renderConnection();
}

export async function refresh(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`status.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = sanitizeStatus(await response.json());
    fetchFailed = false;
    if (typeof document !== 'undefined') render(status);
    return status;
  } catch (error) {
    fetchFailed = true;
    if (typeof document !== 'undefined') renderConnection();
    throw error;
  }
}

if (typeof document !== 'undefined') {
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 60_000);
  setInterval(renderConnection, 15_000);
}
