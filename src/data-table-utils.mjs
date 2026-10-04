const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d(?::?[0-5]\d)?)?$/i;
const INTEGER_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i;

function hasSignificantLeadingZero(text) {
  const unsigned = text.replace(/^[+-]/, '');
  return /^0\d+/.test(unsigned);
}

function isValidIsoDate(text) {
  if (!ISO_DATE_RE.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function scalarType(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'bigint') return 'integer';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (value instanceof Date) return 'timestamp';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  const text = String(value).trim();
  if (!text) return null;
  if (/^(?:true|false)$/i.test(text)) return 'boolean';
  if (ISO_TIMESTAMP_RE.test(text) && !Number.isNaN(Date.parse(text.replace(' ', 'T')))) return 'timestamp';
  if (isValidIsoDate(text)) return 'date';
  if (INTEGER_RE.test(text) && !hasSignificantLeadingZero(text)) return 'integer';
  if (NUMBER_RE.test(text) && !hasSignificantLeadingZero(text)) return 'number';
  return 'string';
}

function mergeType(current, next) {
  if (!next) return current;
  if (!current) return next;
  if (current === next) return current;
  if ((current === 'integer' && next === 'number') || (current === 'number' && next === 'integer')) return 'number';
  if ((current === 'date' && next === 'timestamp') || (current === 'timestamp' && next === 'date')) return 'timestamp';
  return 'mixed';
}


function delimiterCountsByLine(text, delimiter, maxLines = 12) {
  const counts = [];
  let count = 0;
  let inQuotes = false;
  let hasContent = false;
  const sample = String(text ?? '').slice(0, 65536);
  for (let i = 0; i <= sample.length && counts.length < maxLines; i++) {
    const ch = i < sample.length ? sample[i] : '\n';
    if (ch === '"') {
      if (inQuotes && sample[i + 1] === '"') { i++; hasContent = true; continue; }
      inQuotes = !inQuotes;
      hasContent = true;
      continue;
    }
    if (!inQuotes && ch === delimiter) { count++; hasContent = true; continue; }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && sample[i + 1] === '\n') i++;
      if (hasContent || count) counts.push(count);
      count = 0;
      hasContent = false;
      continue;
    }
    if (!/\s/.test(ch)) hasContent = true;
  }
  return counts;
}

function detectDelimiter(text) {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of candidates) {
    const counts = delimiterCountsByLine(text, delimiter);
    if (!counts.length) continue;
    const positives = counts.filter(count => count > 0);
    if (!positives.length) continue;
    const frequencies = new Map();
    for (const count of positives) frequencies.set(count, (frequencies.get(count) || 0) + 1);
    let modeCount = 0;
    let modeFrequency = 0;
    for (const [count, frequency] of frequencies) {
      if (frequency > modeFrequency || (frequency === modeFrequency && count > modeCount)) {
        modeCount = count;
        modeFrequency = frequency;
      }
    }
    const missing = counts.length - positives.length;
    const inconsistent = positives.length - modeFrequency;
    const score = modeFrequency * 100 + modeCount * 4 - inconsistent * 25 - missing * 15;
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

function inferSchema(columns, rows) {
  const safeColumns = Array.isArray(columns) ? columns.map(String) : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  return safeColumns.map(name => {
    let type = null;
    let nullCount = 0;
    let emptyCount = 0;
    let observedCount = 0;
    for (const row of safeRows) {
      const value = row?.[name];
      if (value === null || value === undefined) {
        nullCount++;
        continue;
      }
      if (value === '') {
        emptyCount++;
        continue;
      }
      observedCount++;
      type = mergeType(type, scalarType(value));
      if (type === 'mixed') break;
    }
    return {
      name,
      type: type || 'string',
      nullable: nullCount > 0,
      nullCount,
      emptyCount,
      observedCount
    };
  });
}


function jsonSafeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafeValue(item);
    return out;
  }
  return value;
}

function stringifyJsonl(data) {
  const columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows.map(row => {
    const record = {};
    for (const column of columns) record[column] = jsonSafeValue(row?.[column]);
    return JSON.stringify(record);
  }).join('\n') + (rows.length ? '\n' : '');
}

function parseJsonl(text, limit = Infinity) {
  const columns = [];
  const seen = new Set();
  const rawRows = [];
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const source = lines[index].trim();
    if (!source) continue;
    let value;
    try {
      value = JSON.parse(source);
    } catch (cause) {
      const error = new Error(`Invalid JSONL at line ${index + 1}.`);
      error.code = 'JSONL_PARSE';
      error.line = index + 1;
      error.cause = cause;
      throw error;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      const error = new Error(`JSONL line ${index + 1} must be a JSON object.`);
      error.code = 'JSONL_OBJECT';
      error.line = index + 1;
      throw error;
    }
    for (const key of Object.keys(value)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
    rawRows.push(value);
    if (rawRows.length >= limit) break;
  }
  const rows = rawRows.map(row => Object.fromEntries(columns.map(column => [column, Object.hasOwn(row, column) ? row[column] : null])));
  return { columns, rows };
}


function tableError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cloneTable(data, overrides = {}) {
  return { ...data, columns: [...(data?.columns || [])], rows: [...(data?.rows || [])], ...overrides };
}

function requireColumns(data, columns) {
  const available = new Set(data?.columns || []);
  for (const column of columns) {
    if (!available.has(column)) throw tableError('COLUMN_NOT_FOUND', `Column not found: ${column}`, { column });
  }
}

function renameColumns(data, mappings) {
  const rules = (Array.isArray(mappings) ? mappings : [])
    .map(rule => ({ from: String(rule?.from ?? '').trim(), to: String(rule?.to ?? '').trim() }))
    .filter(rule => rule.from || rule.to);
  if (!rules.length) return cloneTable(data);
  requireColumns(data, rules.map(rule => rule.from));
  const fromSet = new Set();
  const renameMap = new Map();
  for (const rule of rules) {
    if (!rule.from || !rule.to) throw tableError('INVALID_RENAME', 'Rename requires both source and target column names.');
    if (fromSet.has(rule.from)) throw tableError('INVALID_RENAME', `Column is renamed more than once: ${rule.from}`, { column: rule.from });
    fromSet.add(rule.from);
    renameMap.set(rule.from, rule.to);
  }
  const columns = data.columns.map(column => renameMap.get(column) || column);
  const unique = new Set();
  for (const column of columns) {
    if (unique.has(column)) throw tableError('COLUMN_NAME_COLLISION', `Duplicate output column name: ${column}`, { column });
    unique.add(column);
  }
  const rows = data.rows.map(row => Object.fromEntries(data.columns.map((column, index) => [columns[index], row?.[column] ?? null])));
  return cloneTable(data, { columns, rows });
}

function sortableValue(value) {
  if (value === null || value === undefined || value === '') return { missing: true, value: null, type: 'missing' };
  const type = scalarType(value);
  if (type === 'integer' || type === 'number') return { missing: false, value: Number(value), type: 'number' };
  if (type === 'date' || type === 'timestamp') return { missing: false, value: value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T')), type: 'number' };
  if (type === 'boolean') return { missing: false, value: typeof value === 'boolean' ? value : /^true$/i.test(String(value)), type: 'boolean' };
  return { missing: false, value: String(value), type: 'string' };
}

function compareSortable(a, b) {
  if (a.missing || b.missing) return a.missing === b.missing ? 0 : a.missing ? 1 : -1;
  if (a.type === 'string' || b.type === 'string') return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' });
  if (a.value === b.value) return 0;
  return a.value < b.value ? -1 : 1;
}

function sortRows(data, keys) {
  const rules = (Array.isArray(keys) ? keys : [])
    .map(rule => ({ column: String(rule?.column ?? '').trim(), direction: String(rule?.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc' }))
    .filter(rule => rule.column);
  if (!rules.length) return cloneTable(data);
  requireColumns(data, rules.map(rule => rule.column));
  const rows = data.rows.map((row, index) => ({ row, index }));
  rows.sort((left, right) => {
    for (const rule of rules) {
      const a = sortableValue(left.row?.[rule.column]);
      const b = sortableValue(right.row?.[rule.column]);
      let compared = compareSortable(a, b);
      // Missing values stay at the end for both directions.
      if (!(a.missing || b.missing) && rule.direction === 'desc') compared *= -1;
      if (compared) return compared;
    }
    return left.index - right.index;
  });
  return cloneTable(data, { rows: rows.map(item => item.row) });
}

function limitRows(data, limit) {
  const count = Number(limit);
  if (!Number.isInteger(count) || count < 0) throw tableError('INVALID_LIMIT', 'Limit must be a non-negative integer.', { value: limit });
  const totalRows = Number.isFinite(data?.totalRows) ? Math.min(data.totalRows, count) : Math.min(data?.rows?.length || 0, count);
  return cloneTable(data, { rows: data.rows.slice(0, count), totalRows });
}

function castScalar(value, type) {
  const target = String(type || '').toLowerCase();
  if (value === null || value === undefined) return null;
  if (target !== 'string' && value === '') return null;
  if (target === 'string') return String(value);
  if (target === 'integer') {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    const text = String(value).trim();
    if (!/^[+-]?\d+(?:\.0+)?$/.test(text)) throw new Error('invalid integer');
    const number = Number(text);
    if (!Number.isSafeInteger(number)) throw new Error('unsafe integer');
    return number;
  }
  if (target === 'number' || target === 'decimal' || target === 'double') {
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number)) throw new Error('invalid number');
    return number;
  }
  if (target === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return Boolean(value);
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
    throw new Error('invalid boolean');
  }
  if (target === 'date') {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    if (!isValidIsoDate(text)) throw new Error('invalid date');
    return text;
  }
  if (target === 'timestamp') {
    const date = value instanceof Date ? value : new Date(String(value).trim().replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp');
    return date.toISOString();
  }
  throw tableError('CAST_TYPE_UNSUPPORTED', `Unsupported cast type: ${type}`, { type });
}

function castColumns(data, casts, failureMode = 'error') {
  const rules = (Array.isArray(casts) ? casts : [])
    .map(rule => ({ column: String(rule?.column ?? '').trim(), type: String(rule?.type ?? '').trim().toLowerCase() }))
    .filter(rule => rule.column || rule.type);
  if (!rules.length) return cloneTable(data);
  requireColumns(data, rules.map(rule => rule.column));
  const mode = failureMode === 'null' ? 'null' : 'error';
  const rows = data.rows.map(row => {
    const next = { ...row };
    for (const rule of rules) {
      if (!rule.column || !rule.type) throw tableError('INVALID_CAST', 'Cast requires a column and target type.', { column: rule.column });
      try {
        next[rule.column] = castScalar(row?.[rule.column], rule.type);
      } catch (cause) {
        if (cause?.code === 'CAST_TYPE_UNSUPPORTED') throw cause;
        if (mode === 'null') next[rule.column] = null;
        else throw tableError('CAST_FAILED', `Could not cast ${rule.column} to ${rule.type}.`, { column: rule.column, type: rule.type, value: row?.[rule.column], cause });
      }
    }
    return next;
  });
  return cloneTable(data, { rows });
}

function stableValueKey(value) {
  if (value === null) return 'null:';
  if (value === undefined) return 'undefined:';
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Array.isArray(value)) return `array:[${value.map(stableValueKey).join(',')}]`;
  if (typeof value === 'object') return `object:{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(',')}}`;
  return `${typeof value}:${String(value)}`;
}

// Use locale-independent JavaScript Unicode semantics; do not normalize identifiers.
function cleanText(data, options = {}) {
  const { columns, trim = true, caseMode = 'unchanged' } = options;
  if (!Array.isArray(columns) || !columns.length || !['unchanged', 'lowercase', 'uppercase'].includes(caseMode)) {
    throw tableError('INVALID_CLEAN_TEXT', 'Select at least one column and a valid text case.');
  }
  requireColumns(data, columns);
  const selected = new Set(columns);
  const rows = data.rows.map(row => {
    const result = { ...row };
    for (const column of selected) {
      if (typeof row[column] !== 'string') continue;
      let value = trim ? row[column].trim() : row[column];
      if (caseMode === 'lowercase') value = value.toLowerCase();
      if (caseMode === 'uppercase') value = value.toUpperCase();
      result[column] = value;
    }
    return result;
  });
  return cloneTable(data, { rows });
}

function deduplicateRows(data, columns = null) {
  const keys = Array.isArray(columns) && columns.length ? columns.map(String) : [...data.columns];
  requireColumns(data, keys);
  const seen = new Set();
  const rows = [];
  for (const row of data.rows) {
    const key = keys.map(column => stableValueKey(row?.[column])).join('\u001f');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const result = cloneTable(data, { rows });
  delete result.totalRows;
  return result;
}


function comparableFilterValue(value) {
  if (value === null || value === undefined) return { kind: 'null', value: null };
  const type = scalarType(value);
  if (type === 'integer' || type === 'number') return { kind: 'number', value: Number(value) };
  if (type === 'date' || type === 'timestamp') {
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value).trim().replace(' ', 'T'));
    if (!Number.isNaN(time)) return { kind: 'date', value: time };
  }
  if (type === 'boolean') {
    const bool = typeof value === 'boolean' ? value : /^true$/i.test(String(value).trim()) || String(value).trim() === '1';
    return { kind: 'boolean', value: bool };
  }
  return { kind: 'string', value: String(value) };
}

function compareFilterValues(left, right) {
  const a = comparableFilterValue(left);
  const b = comparableFilterValue(right);
  if (a.kind === 'null' || b.kind === 'null') return null;
  if (a.kind === b.kind && ['number', 'date', 'boolean'].includes(a.kind)) {
    if (a.value === b.value) return 0;
    return a.value < b.value ? -1 : 1;
  }
  const av = String(a.value);
  const bv = String(b.value);
  const result = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

function filterConditionMatches(row, rule) {
  const value = row?.[rule.column];
  const isNull = value === null || value === undefined;
  if (rule.operator === 'is-null') return isNull;
  if (rule.operator === 'not-null') return !isNull;
  if (isNull) return false;
  const right = rule.value;
  if (rule.operator === 'contains') return String(value).includes(String(right));
  if (rule.operator === 'starts-with') return String(value).startsWith(String(right));
  if (rule.operator === 'ends-with') return String(value).endsWith(String(right));
  const compared = compareFilterValues(value, right);
  if (compared === null) return false;
  if (rule.operator === 'eq') return compared === 0;
  if (rule.operator === 'neq') return compared !== 0;
  if (rule.operator === 'gt') return compared > 0;
  if (rule.operator === 'gte') return compared >= 0;
  if (rule.operator === 'lt') return compared < 0;
  if (rule.operator === 'lte') return compared <= 0;
  throw tableError('INVALID_FILTER', `Unsupported filter operator: ${rule.operator}`, { operator: rule.operator });
}

function filterRows(data, conditions, combination = 'and') {
  const rules = (Array.isArray(conditions) ? conditions : []).map(condition => ({
    column: String(condition?.column ?? '').trim(),
    operator: String(condition?.operator ?? '').trim().toLowerCase(),
    hasValue: condition != null && Object.hasOwn(condition, 'value'),
    value: condition?.value
  }));
  if (!rules.length) return cloneTable(data);
  for (const rule of rules) {
    const noValueNeeded = rule.operator === 'is-null' || rule.operator === 'not-null';
    if (!rule.column || !rule.operator || (!noValueNeeded && !rule.hasValue)) {
      throw tableError('INVALID_FILTER', 'Filter requires a column, operator, and value.', { column: rule.column, operator: rule.operator });
    }
  }
  requireColumns(data, rules.map(rule => rule.column));
  const mode = String(combination).toLowerCase() === 'or' ? 'or' : 'and';
  const rows = data.rows.filter(row => {
    const matches = rules.map(rule => filterConditionMatches(row, rule));
    return mode === 'or' ? matches.some(Boolean) : matches.every(Boolean);
  });
  const result = cloneTable(data, { rows });
  delete result.totalRows;
  return result;
}

function handleNulls(data, options = {}) {
  const mode = options?.mode === 'replace' ? 'replace' : options?.mode === 'remove' ? 'remove' : '';
  const columns = Array.isArray(options?.columns) ? options.columns.map(column => String(column).trim()).filter(Boolean) : [];
  if (!mode) throw tableError('INVALID_NULL_HANDLING', 'Choose how to handle Null values.');
  if (!columns.length) throw tableError('INVALID_NULL_HANDLING', 'Select at least one column for Null handling.');
  requireColumns(data, columns);
  if (mode === 'remove') {
    const rows = data.rows.filter(row => columns.every(column => row?.[column] !== null && row?.[column] !== undefined));
    const result = cloneTable(data, { rows });
    delete result.totalRows;
    return result;
  }
  const replacement = options?.replacement ?? '';
  const rows = data.rows.map(row => {
    const next = { ...row };
    for (const column of columns) {
      if (next[column] === null || next[column] === undefined) next[column] = replacement;
    }
    return next;
  });
  const result = cloneTable(data, { rows });
  delete result.totalRows;
  return result;
}


function normalizedJoinType(type) {
  const value = String(type || 'inner').toLowerCase();
  return ['inner', 'left', 'right', 'full'].includes(value) ? value : 'inner';
}

function joinKeyValue(row, columns) {
  const values = [];
  for (const column of columns) {
    const value = row?.[column];
    if (value === null || value === undefined) return null;
    values.push(stableValueKey(value));
  }
  return values.join('\u001e');
}

function joinedRightColumnNames(leftColumns, rightColumns) {
  const used = new Set(leftColumns);
  const names = new Map();
  for (const column of rightColumns) {
    let candidate = column;
    if (used.has(candidate)) candidate = `${column}_right`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${column}_right${suffix++}`;
    used.add(candidate);
    names.set(column, candidate);
  }
  return names;
}

function joinTables(left, right, options = {}) {
  const type = normalizedJoinType(options?.type);
  const keys = (Array.isArray(options?.keys) ? options.keys : []).map(rule => ({
    left: String(rule?.left ?? '').trim(),
    right: String(rule?.right ?? '').trim()
  })).filter(rule => rule.left || rule.right);
  if (!keys.length || keys.some(rule => !rule.left || !rule.right)) {
    throw tableError('INVALID_JOIN', 'Join requires at least one complete key pair.');
  }
  requireColumns(left, keys.map(rule => rule.left));
  requireColumns(right, keys.map(rule => rule.right));

  const leftColumns = [...(left?.columns || [])];
  const rightColumns = [...(right?.columns || [])];
  const rightNames = joinedRightColumnNames(leftColumns, rightColumns);
  const columns = [...leftColumns, ...rightColumns.map(column => rightNames.get(column))];
  const leftKeyColumns = keys.map(rule => rule.left);
  const rightKeyColumns = keys.map(rule => rule.right);
  const rightIndex = new Map();
  right.rows.forEach((row, index) => {
    const key = joinKeyValue(row, rightKeyColumns);
    if (key === null) return;
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key).push({ row, index });
  });
  const matchedRight = new Set();
  const rows = [];
  const combine = (leftRow, rightRow) => {
    const out = {};
    for (const column of leftColumns) out[column] = leftRow ? (leftRow[column] ?? null) : null;
    for (const column of rightColumns) out[rightNames.get(column)] = rightRow ? (rightRow[column] ?? null) : null;
    return out;
  };

  for (const leftRow of left.rows) {
    const key = joinKeyValue(leftRow, leftKeyColumns);
    const matches = key === null ? [] : (rightIndex.get(key) || []);
    if (matches.length) {
      for (const match of matches) {
        matchedRight.add(match.index);
        rows.push(combine(leftRow, match.row));
      }
    } else if (type === 'left' || type === 'full') {
      rows.push(combine(leftRow, null));
    }
  }
  if (type === 'right' || type === 'full') {
    right.rows.forEach((rightRow, index) => {
      if (!matchedRight.has(index)) rows.push(combine(null, rightRow));
    });
  }
  if (type === 'right') {
    // Rebuild right joins in right-row order so output order is predictable.
    rows.length = 0;
    const leftIndex = new Map();
    left.rows.forEach((row, index) => {
      const key = joinKeyValue(row, leftKeyColumns);
      if (key === null) return;
      if (!leftIndex.has(key)) leftIndex.set(key, []);
      leftIndex.get(key).push({ row, index });
    });
    for (const rightRow of right.rows) {
      const key = joinKeyValue(rightRow, rightKeyColumns);
      const matches = key === null ? [] : (leftIndex.get(key) || []);
      if (matches.length) for (const match of matches) rows.push(combine(match.row, rightRow));
      else rows.push(combine(null, rightRow));
    }
  }
  return { columns, rows, joinColumnMap: Object.fromEntries(rightNames) };
}

function unionSchemaMismatch(tables, mode, outputColumns) {
  const first = tables[0]?.columns || [];
  const inputs = tables.map((table, index) => {
    const columns = table?.columns || [];
    if (mode === 'position') {
      const renamed = columns.map((column, i) => ({ from: column, to: outputColumns[i] ?? null })).filter(item => item.from !== item.to);
      return { index, missing: [], extra: [], renamed, countMismatch: columns.length !== first.length };
    }
    const set = new Set(columns);
    const outputSet = new Set(outputColumns);
    return {
      index,
      missing: outputColumns.filter(column => !set.has(column)),
      extra: columns.filter(column => !new Set(first).has(column)),
      renamed: [],
      countMismatch: false
    };
  });
  return { hasMismatch: inputs.some(item => item.missing.length || item.extra.length || item.renamed.length || item.countMismatch), inputs };
}

function unionTables(tables, options = {}) {
  const inputs = Array.isArray(tables) ? tables.filter(Boolean) : [];
  if (inputs.length < 2 || inputs.length > 6) throw tableError('INVALID_UNION', 'Union requires between 2 and 6 inputs.', { inputCount: inputs.length });
  const mode = options?.mode === 'position' ? 'position' : 'name';
  if (mode === 'position') {
    const width = inputs[0].columns.length;
    const mismatched = inputs.findIndex(table => table.columns.length !== width);
    if (mismatched >= 0) throw tableError('UNION_SCHEMA_MISMATCH', 'Union by position requires the same number of columns in every input.', { inputIndex: mismatched, expected: width, actual: inputs[mismatched].columns.length });
    const columns = [...inputs[0].columns];
    const rows = [];
    for (const table of inputs) {
      for (const row of table.rows) {
        const next = {};
        table.columns.forEach((column, index) => { next[columns[index]] = row?.[column] ?? null; });
        rows.push(next);
      }
    }
    return { columns, rows, schemaMismatch: unionSchemaMismatch(inputs, mode, columns) };
  }
  const columns = [];
  const seen = new Set();
  for (const table of inputs) for (const column of table.columns) if (!seen.has(column)) { seen.add(column); columns.push(column); }
  const rows = [];
  for (const table of inputs) for (const row of table.rows) rows.push(Object.fromEntries(columns.map(column => [column, table.columns.includes(column) ? (row?.[column] ?? null) : null])));
  return { columns, rows, schemaMismatch: unionSchemaMismatch(inputs, mode, columns) };
}


function normalizedAggregateOperation(operation) {
  const value = String(operation || '').trim().toLowerCase();
  if (value === 'avg') return 'average';
  return ['count', 'sum', 'average', 'min', 'max'].includes(value) ? value : '';
}

function aggregateNumericValues(rows, column, operation) {
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    const value = row?.[column];
    if (value === null || value === undefined || value === '') continue;
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number)) {
      throw tableError('AGGREGATE_NUMERIC_REQUIRED', `${operation} requires numeric values in column ${column}.`, { column, operation, value });
    }
    count++;
    sum += number;
  }
  if (!count) return null;
  return operation === 'average' ? sum / count : sum;
}

function aggregateExtremeValue(rows, column, operation) {
  let chosen;
  let chosenSortable;
  for (const row of rows) {
    const value = row?.[column];
    if (value === null || value === undefined || value === '') continue;
    const sortable = sortableValue(value);
    if (chosenSortable === undefined) {
      chosen = value;
      chosenSortable = sortable;
      continue;
    }
    const compared = compareSortable(sortable, chosenSortable);
    if ((operation === 'min' && compared < 0) || (operation === 'max' && compared > 0)) {
      chosen = value;
      chosenSortable = sortable;
    }
  }
  return chosenSortable === undefined ? null : chosen;
}

function groupByAggregate(data, groupColumns = [], aggregates = []) {
  const groups = Array.isArray(groupColumns) ? groupColumns.map(column => String(column).trim()).filter(Boolean) : [];
  if (new Set(groups).size !== groups.length) throw tableError('INVALID_AGGREGATE', 'Group columns must be unique.');
  requireColumns(data, groups);

  const rules = (Array.isArray(aggregates) ? aggregates : []).map(rule => ({
    operation: normalizedAggregateOperation(rule?.operation),
    column: String(rule?.column ?? '').trim(),
    as: String(rule?.as ?? '').trim()
  }));
  if (!rules.length) throw tableError('INVALID_AGGREGATE', 'Add at least one aggregate.');

  const outputNames = new Set(groups);
  for (const rule of rules) {
    if (!rule.operation || !rule.as || (rule.operation !== 'count' && !rule.column)) {
      throw tableError('INVALID_AGGREGATE', 'Each aggregate needs an operation, source column when required, and output name.', { operation: rule.operation, column: rule.column, as: rule.as });
    }
    if (rule.operation === 'count') rule.column = '*';
    else requireColumns(data, [rule.column]);
    if (outputNames.has(rule.as)) throw tableError('AGGREGATE_NAME_COLLISION', `Duplicate output column name: ${rule.as}`, { column: rule.as });
    outputNames.add(rule.as);
  }

  const buckets = new Map();
  const ensureBucket = (key, firstRow) => {
    if (!buckets.has(key)) buckets.set(key, { firstRow, rows: [] });
    return buckets.get(key);
  };
  if (!groups.length) ensureBucket('__all__', null);
  for (const row of data?.rows || []) {
    const key = groups.length ? groups.map(column => stableValueKey(row?.[column])).join('\u001d') : '__all__';
    ensureBucket(key, row).rows.push(row);
  }

  const rows = [];
  for (const bucket of buckets.values()) {
    const output = {};
    for (const column of groups) output[column] = bucket.firstRow?.[column] ?? null;
    for (const rule of rules) {
      if (rule.operation === 'count') output[rule.as] = bucket.rows.length;
      else if (rule.operation === 'sum' || rule.operation === 'average') output[rule.as] = aggregateNumericValues(bucket.rows, rule.column, rule.operation);
      else output[rule.as] = aggregateExtremeValue(bucket.rows, rule.column, rule.operation);
    }
    rows.push(output);
  }
  return { columns: [...groups, ...rules.map(rule => rule.as)], rows };
}

function formatPreviewValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

const DataTableUtils = Object.freeze({
  scalarType,
  detectDelimiter,
  inferSchema,
  parseJsonl,
  stringifyJsonl,
  formatPreviewValue,
  renameColumns,
  sortRows,
  limitRows,
  castColumns,
  cleanText,
  deduplicateRows,
  filterRows,
  handleNulls,
  joinTables,
  unionTables,
  groupByAggregate
});

if (typeof window !== 'undefined') window.DataTableUtils = DataTableUtils;
export default DataTableUtils;
