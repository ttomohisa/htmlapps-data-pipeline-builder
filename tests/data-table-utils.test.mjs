import test from 'node:test';
import assert from 'node:assert/strict';
import DataTableUtils from '../src/data-table-utils.mjs';
import { gzipSync } from 'node:zlib';

test('schema inference recognizes common CSV scalar types without turning zero-padded identifiers into numbers', () => {
  const data = {
    columns: ['id', 'price', 'active', 'date', 'created_at', 'code', 'note'],
    rows: [
      { id: '1', price: '12.5', active: 'true', date: '2026-09-01', created_at: '2026-09-01T10:20:30Z', code: '0012', note: '' },
      { id: '2', price: '8', active: 'false', date: '2026-09-02', created_at: '2026-09-02T11:00:00Z', code: '0013', note: 'ok' },
      { id: '3', price: '', active: '', date: '', created_at: '', code: '', note: null }
    ]
  };
  const schema = DataTableUtils.inferSchema(data.columns, data.rows);
  const byName = Object.fromEntries(schema.map(column => [column.name, column]));
  assert.equal(byName.id.type, 'integer');
  assert.equal(byName.price.type, 'number');
  assert.equal(byName.active.type, 'boolean');
  assert.equal(byName.date.type, 'date');
  assert.equal(byName.created_at.type, 'timestamp');
  assert.equal(byName.code.type, 'string');
  assert.equal(byName.note.type, 'string');
  assert.equal(byName.note.emptyCount, 1);
  assert.equal(byName.note.nullCount, 1);
});

test('schema inference preserves native JSON types and reports mixed columns', () => {
  const rows = [
    { count: 1, payload: { a: 1 }, tags: ['a'], mixed: 1 },
    { count: 2, payload: { a: 2 }, tags: ['b'], mixed: 'x' }
  ];
  const schema = DataTableUtils.inferSchema(['count', 'payload', 'tags', 'mixed'], rows);
  assert.deepEqual(schema.map(({ name, type }) => [name, type]), [
    ['count', 'integer'],
    ['payload', 'object'],
    ['tags', 'array'],
    ['mixed', 'mixed']
  ]);
});

test('JSONL parser unions object keys in first-seen order and fills missing values with null', () => {
  const parsed = DataTableUtils.parseJsonl('{"id":1,"name":"Alice"}\n{"id":2,"active":true}\n');
  assert.deepEqual(parsed.columns, ['id', 'name', 'active']);
  assert.deepEqual(parsed.rows, [
    { id: 1, name: 'Alice', active: null },
    { id: 2, name: null, active: true }
  ]);
});

test('JSONL parser reports the failing source line', () => {
  assert.throws(
    () => DataTableUtils.parseJsonl('{"id":1}\nnot-json\n'),
    error => error instanceof Error && error.code === 'JSONL_PARSE' && error.line === 2
  );
});

test('preview values stringify nested JSON without losing null and empty distinctions', () => {
  assert.equal(DataTableUtils.formatPreviewValue(null), 'NULL');
  assert.equal(DataTableUtils.formatPreviewValue(''), '');
  assert.equal(DataTableUtils.formatPreviewValue({ b: 2, a: 1 }), '{"b":2,"a":1}');
  assert.equal(DataTableUtils.formatPreviewValue(['x', 2]), '["x",2]');
});

test('delimiter autodetect ignores delimiters inside quotes and uses consistent sampled rows', () => {
  assert.equal(DataTableUtils.detectDelimiter('name;note;value\nAlice;"hello, world";1\nBob;"x,y";2\n'), ';');
  assert.equal(DataTableUtils.detectDelimiter('id\tname\n1\tAlice\n2\tBob\n'), '\t');
});

// Minimal Parquet fixture writer for reader tests. This is intentionally test-only
// and encodes the compact-Thrift structures directly instead of calling production code.
const CT_STOP=0, CT_TRUE=1, CT_FALSE=2, CT_BYTE=3, CT_I16=4, CT_I32=5, CT_I64=6, CT_DOUBLE=7, CT_BINARY=8, CT_LIST=9, CT_STRUCT=12;
function varint(value){let n=BigInt(value);const out=[];do{let b=Number(n&0x7fn);n>>=7n;if(n)b|=0x80;out.push(b)}while(n);return out}
function zigzag(value){const n=BigInt(value);return varint((n<<1n)^(n>>63n))}
function binary(text){const bytes=[...new TextEncoder().encode(text)];return [...varint(bytes.length),...bytes]}
function field(fid,type,payload,prev){const delta=fid-prev;return {bytes:[...(delta>0&&delta<=15?[(delta<<4)|type]:[type,...zigzag(fid)]),...payload],fid}}
function struct(fields){let prev=0,out=[];for(const item of fields){const encoded=field(item.id,item.type,item.payload,prev);out.push(...encoded.bytes);prev=encoded.fid}out.push(CT_STOP);return out}
function list(type,items){const head=items.length<15?[(items.length<<4)|type]:[0xf0|type,...varint(items.length)];return [...head,...items.flat()]}
function intField(id,value,type=CT_I32){return {id,type,payload:zigzag(value)}}
function binField(id,value){return {id,type:CT_BINARY,payload:binary(value)}}
function structField(id,bytes){return {id,type:CT_STRUCT,payload:bytes}}
function listField(id,type,items){return {id,type:CT_LIST,payload:list(type,items)}}
function makeTinyParquet(values=[1,2,3]){
  const pageData=[];for(const value of values){const b=new ArrayBuffer(4);new DataView(b).setInt32(0,value,true);pageData.push(...new Uint8Array(b))}
  const dataHeader=struct([intField(1,values.length),intField(2,0),intField(3,3),intField(4,3)]);
  const pageHeader=struct([intField(1,0),intField(2,pageData.length),intField(3,pageData.length),structField(5,dataHeader)]);
  const chunkStart=4;
  const chunkSize=pageHeader.length+pageData.length;
  const rootSchema=struct([binField(4,'schema'),intField(5,1)]);
  const idSchema=struct([intField(1,1),intField(3,0),binField(4,'id')]);
  const columnMeta=struct([
    intField(1,1),
    listField(2,CT_I32,[zigzag(0),zigzag(3)]),
    listField(3,CT_BINARY,[binary('id')]),
    intField(4,0),
    intField(5,values.length,CT_I64),
    intField(6,chunkSize,CT_I64),
    intField(7,chunkSize,CT_I64),
    intField(9,chunkStart,CT_I64),
  ]);
  const columnChunk=struct([intField(2,chunkStart,CT_I64),structField(3,columnMeta)]);
  const rowGroup=struct([
    listField(1,CT_STRUCT,[columnChunk]),
    intField(2,chunkSize,CT_I64),
    intField(3,values.length,CT_I64),
    intField(6,chunkSize,CT_I64),
  ]);
  const metadata=struct([
    intField(1,1),
    listField(2,CT_STRUCT,[rootSchema,idSchema]),
    intField(3,values.length,CT_I64),
    listField(4,CT_STRUCT,[rowGroup]),
    binField(6,'Browser Kitty test fixture'),
  ]);
  const footerLen=new ArrayBuffer(4);new DataView(footerLen).setUint32(0,metadata.length,true);
  return new Uint8Array([
    0x50,0x41,0x52,0x31,
    ...pageHeader,...pageData,...metadata,...new Uint8Array(footerLen),
    0x50,0x41,0x52,0x31,
  ]).buffer;
}


function snappyLiteral(bytes){
  const length=bytes.length;
  if(length<1||length>60)throw new Error('test helper only supports 1..60 byte literals');
  return Uint8Array.from([...varint(length),((length-1)<<2),...bytes]);
}
function makeTinyParquetCompressed(values=[1,2,3],codec=1){
  const raw=[];for(const value of values){const b=new ArrayBuffer(4);new DataView(b).setInt32(0,value,true);raw.push(...new Uint8Array(b))}
  const rawBytes=Uint8Array.from(raw);
  const pageData=codec===1?snappyLiteral(rawBytes):codec===2?new Uint8Array(gzipSync(rawBytes)):rawBytes;
  const dataHeader=struct([intField(1,values.length),intField(2,0),intField(3,3),intField(4,3)]);
  const pageHeader=struct([intField(1,0),intField(2,rawBytes.length),intField(3,pageData.length),structField(5,dataHeader)]);
  const chunkStart=4;
  const chunkSize=pageHeader.length+pageData.length;
  const rootSchema=struct([binField(4,'schema'),intField(5,1)]);
  const idSchema=struct([intField(1,1),intField(3,0),binField(4,'id')]);
  const columnMeta=struct([
    intField(1,1),
    listField(2,CT_I32,[zigzag(0),zigzag(3)]),
    listField(3,CT_BINARY,[binary('id')]),
    intField(4,codec),
    intField(5,values.length,CT_I64),
    intField(6,pageHeader.length+rawBytes.length,CT_I64),
    intField(7,chunkSize,CT_I64),
    intField(9,chunkStart,CT_I64),
  ]);
  const columnChunk=struct([intField(2,chunkStart,CT_I64),structField(3,columnMeta)]);
  const rowGroup=struct([listField(1,CT_STRUCT,[columnChunk]),intField(2,chunkSize,CT_I64),intField(3,values.length,CT_I64),intField(6,chunkSize,CT_I64)]);
  const metadata=struct([intField(1,1),listField(2,CT_STRUCT,[rootSchema,idSchema]),intField(3,values.length,CT_I64),listField(4,CT_STRUCT,[rowGroup]),binField(6,'Browser Kitty compressed test fixture')]);
  const footerLen=new ArrayBuffer(4);new DataView(footerLen).setUint32(0,metadata.length,true);
  return new Uint8Array([0x50,0x41,0x52,0x31,...pageHeader,...pageData,...metadata,...new Uint8Array(footerLen),0x50,0x41,0x52,0x31]).buffer;
}
test('lightweight Parquet reader loads a real compact-Thrift/PLAIN parquet table', async () => {
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const table = await ParquetLite.readParquetTable(makeTinyParquet([7,8,9]), { limit: 2 });
  assert.deepEqual(table.columns, ['id']);
  assert.deepEqual(table.rows, [{id:7},{id:8}]);
  assert.equal(table.totalRows, 3);
  assert.equal(table.schema[0].name, 'id');
  assert.equal(table.schema[0].parquetType, 'INT32');
});

test('lightweight Parquet reader rejects files without the PAR1 footer', async () => {
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  await assert.rejects(() => ParquetLite.readParquetTable(new TextEncoder().encode('not parquet').buffer), /PAR1|Parquet/i);
});

test('lightweight Snappy decoder handles a literal block without WASM', async () => {
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const decoded = ParquetLite.snappyUncompress(new Uint8Array([3,8,97,98,99]), 3);
  assert.equal(new TextDecoder().decode(decoded), 'abc');
});


test('lightweight Parquet reader loads a real Snappy-compressed page', async () => {
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const table = await ParquetLite.readParquetTable(makeTinyParquetCompressed([11,12,13], 1));
  assert.deepEqual(table.rows, [{id:11},{id:12},{id:13}]);
});

test('lightweight Parquet reader loads a real GZIP-compressed page when DecompressionStream is available', async (t) => {
  if (typeof DecompressionStream === 'undefined') return t.skip('DecompressionStream is unavailable in this Node runtime');
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const table = await ParquetLite.readParquetTable(makeTinyParquetCompressed([21,22], 2));
  assert.deepEqual(table.rows, [{id:21},{id:22}]);
});

test('Rename Columns supports multiple mappings while preserving column order', () => {
  const input = { columns: ['id', 'name', 'price'], rows: [{ id: 1, name: 'A', price: 10 }] };
  const result = DataTableUtils.renameColumns(input, [
    { from: 'name', to: 'customer_name' },
    { from: 'price', to: 'amount' }
  ]);
  assert.deepEqual(result.columns, ['id', 'customer_name', 'amount']);
  assert.deepEqual(result.rows, [{ id: 1, customer_name: 'A', amount: 10 }]);
});

test('Rename Columns rejects missing source columns and target collisions', () => {
  const input = { columns: ['id', 'name'], rows: [{ id: 1, name: 'A' }] };
  assert.throws(() => DataTableUtils.renameColumns(input, [{ from: 'missing', to: 'x' }]), error => error.code === 'COLUMN_NOT_FOUND' && error.column === 'missing');
  assert.throws(() => DataTableUtils.renameColumns(input, [{ from: 'name', to: 'id' }]), error => error.code === 'COLUMN_NAME_COLLISION' && error.column === 'id');
});

test('Sort supports multiple keys and keeps null values last', () => {
  const input = {
    columns: ['group', 'score', 'id'],
    rows: [
      { group: 'b', score: '2', id: 3 },
      { group: 'a', score: '10', id: 2 },
      { group: 'a', score: '3', id: 1 },
      { group: 'a', score: null, id: 4 }
    ]
  };
  const result = DataTableUtils.sortRows(input, [
    { column: 'group', direction: 'asc' },
    { column: 'score', direction: 'desc' }
  ]);
  assert.deepEqual(result.rows.map(row => row.id), [2, 1, 4, 3]);
});

test('Limit keeps only the first N rows without mutating the input', () => {
  const input = { columns: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const result = DataTableUtils.limitRows(input, 2);
  assert.deepEqual(result.rows, [{ id: 1 }, { id: 2 }]);
  assert.equal(input.rows.length, 3);
  assert.throws(() => DataTableUtils.limitRows(input, -1), error => error.code === 'INVALID_LIMIT');
});

test('Cast converts supported scalar types and can turn failures into null', () => {
  const input = {
    columns: ['id', 'price', 'active', 'date', 'created'],
    rows: [
      { id: '12', price: '3.5', active: 'true', date: '2026-09-17', created: '2026-09-17 08:30:00' },
      { id: 'bad', price: '', active: '0', date: 'bad', created: null }
    ]
  };
  const result = DataTableUtils.castColumns(input, [
    { column: 'id', type: 'integer' },
    { column: 'price', type: 'number' },
    { column: 'active', type: 'boolean' },
    { column: 'date', type: 'date' },
    { column: 'created', type: 'timestamp' }
  ], 'null');
  assert.deepEqual(result.rows[0], { id: 12, price: 3.5, active: true, date: '2026-09-17', created: '2026-09-17T08:30:00.000Z' });
  assert.deepEqual(result.rows[1], { id: null, price: null, active: false, date: null, created: null });
});

test('Cast error mode reports the column and source value instead of silently changing it', () => {
  const input = { columns: ['price'], rows: [{ price: 'oops' }] };
  assert.throws(
    () => DataTableUtils.castColumns(input, [{ column: 'price', type: 'number' }], 'error'),
    error => error.code === 'CAST_FAILED' && error.column === 'price' && error.value === 'oops'
  );
});

test('Deduplicate can use all columns or selected key columns and keeps the first row', () => {
  const input = {
    columns: ['id', 'name'],
    rows: [
      { id: 1, name: 'A' },
      { id: 1, name: 'A' },
      { id: 1, name: 'B' },
      { id: 2, name: 'B' }
    ]
  };
  assert.deepEqual(DataTableUtils.deduplicateRows(input, null).rows, [
    { id: 1, name: 'A' }, { id: 1, name: 'B' }, { id: 2, name: 'B' }
  ]);
  assert.deepEqual(DataTableUtils.deduplicateRows(input, ['id']).rows, [
    { id: 1, name: 'A' }, { id: 2, name: 'B' }
  ]);
});

test('Filter Rows supports numeric comparison, string operators, and AND / OR groups', () => {
  const input = {
    columns: ['price', 'status', 'name'],
    rows: [
      { price: '1200', status: 'active', name: 'Alpha' },
      { price: '900', status: 'active', name: 'Beta' },
      { price: '1500', status: 'paused', name: 'Alpine' }
    ]
  };
  const andResult = DataTableUtils.filterRows(input, [
    { column: 'price', operator: 'gt', value: '1000' },
    { column: 'status', operator: 'eq', value: 'active' }
  ], 'and');
  assert.deepEqual(andResult.rows.map(row => row.name), ['Alpha']);

  const orResult = DataTableUtils.filterRows(input, [
    { column: 'name', operator: 'starts-with', value: 'Al' },
    { column: 'status', operator: 'eq', value: 'paused' }
  ], 'or');
  assert.deepEqual(orResult.rows.map(row => row.name), ['Alpha', 'Alpine']);
});

test('Filter Rows distinguishes Null from empty strings and supports null predicates', () => {
  const input = {
    columns: ['note'],
    rows: [{ note: null }, { note: '' }, { note: 'ok' }, {}]
  };
  const nulls = DataTableUtils.filterRows(input, [{ column: 'note', operator: 'is-null' }], 'and');
  assert.deepEqual(nulls.rows, [{ note: null }, {}]);
  const notNulls = DataTableUtils.filterRows(input, [{ column: 'note', operator: 'not-null' }], 'and');
  assert.deepEqual(notNulls.rows, [{ note: '' }, { note: 'ok' }]);
});

test('Filter Rows rejects missing columns and incomplete conditions instead of silently matching', () => {
  const input = { columns: ['id'], rows: [{ id: 1 }] };
  assert.throws(
    () => DataTableUtils.filterRows(input, [{ column: 'missing', operator: 'eq', value: '1' }], 'and'),
    error => error.code === 'COLUMN_NOT_FOUND' && error.column === 'missing'
  );
  assert.throws(
    () => DataTableUtils.filterRows(input, [{ column: 'id', operator: 'eq' }], 'and'),
    error => error.code === 'INVALID_FILTER'
  );
});

test('Null Handling can remove rows with Null in selected columns without treating empty strings as Null', () => {
  const input = {
    columns: ['id', 'name'],
    rows: [
      { id: 1, name: null },
      { id: 2, name: '' },
      { id: null, name: 'C' },
      { id: 4, name: 'D' }
    ]
  };
  const result = DataTableUtils.handleNulls(input, { mode: 'remove', columns: ['name'] });
  assert.deepEqual(result.rows, [
    { id: 2, name: '' },
    { id: null, name: 'C' },
    { id: 4, name: 'D' }
  ]);
});

test('Null Handling replaces only Null values in selected columns with a fixed value', () => {
  const input = {
    columns: ['id', 'name'],
    rows: [
      { id: 1, name: null },
      { id: 2, name: '' },
      { id: 3, name: 'C' }
    ]
  };
  const result = DataTableUtils.handleNulls(input, { mode: 'replace', columns: ['name'], replacement: 'N/A' });
  assert.deepEqual(result.rows, [
    { id: 1, name: 'N/A' },
    { id: 2, name: '' },
    { id: 3, name: 'C' }
  ]);
});

test('Join supports inner, left, right, and full joins with multiple keys', () => {
  const left = {
    columns: ['id', 'region', 'name'],
    rows: [
      { id: 1, region: 'jp', name: 'Alice' },
      { id: 2, region: 'jp', name: 'Bob' },
      { id: 2, region: 'us', name: 'Carol' }
    ]
  };
  const right = {
    columns: ['customer_id', 'region', 'tier'],
    rows: [
      { customer_id: 1, region: 'jp', tier: 'gold' },
      { customer_id: 2, region: 'us', tier: 'silver' },
      { customer_id: 3, region: 'jp', tier: 'bronze' }
    ]
  };
  const keys = [
    { left: 'id', right: 'customer_id' },
    { left: 'region', right: 'region' }
  ];
  const inner = DataTableUtils.joinTables(left, right, { type: 'inner', keys });
  assert.deepEqual(inner.columns, ['id', 'region', 'name', 'customer_id', 'region_right', 'tier']);
  assert.deepEqual(inner.rows.map(row => [row.id, row.region, row.tier]), [[1, 'jp', 'gold'], [2, 'us', 'silver']]);

  const leftJoin = DataTableUtils.joinTables(left, right, { type: 'left', keys });
  assert.equal(leftJoin.rows.length, 3);
  assert.equal(leftJoin.rows[1].tier, null);

  const rightJoin = DataTableUtils.joinTables(left, right, { type: 'right', keys });
  assert.equal(rightJoin.rows.length, 3);
  assert.equal(rightJoin.rows[2].id, null);
  assert.equal(rightJoin.rows[2].customer_id, 3);

  const full = DataTableUtils.joinTables(left, right, { type: 'full', keys });
  assert.equal(full.rows.length, 4);
  assert.equal(full.rows[3].customer_id, 3);
});

test('Join does not match Null keys and reports invalid keys explicitly', () => {
  const left = { columns: ['id'], rows: [{ id: null }, { id: 1 }] };
  const right = { columns: ['id'], rows: [{ id: null }, { id: 1 }] };
  const result = DataTableUtils.joinTables(left, right, { type: 'inner', keys: [{ left: 'id', right: 'id' }] });
  assert.deepEqual(result.rows.map(row => row.id), [1]);
  assert.throws(
    () => DataTableUtils.joinTables(left, right, { type: 'inner', keys: [{ left: 'missing', right: 'id' }] }),
    error => error.code === 'COLUMN_NOT_FOUND' && error.column === 'missing'
  );
  assert.throws(
    () => DataTableUtils.joinTables(left, right, { type: 'inner', keys: [] }),
    error => error.code === 'INVALID_JOIN'
  );
});

test('Union by name fills missing columns with Null and reports schema mismatch', () => {
  const first = { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] };
  const second = { columns: ['id', 'active'], rows: [{ id: 2, active: true }] };
  const result = DataTableUtils.unionTables([first, second], { mode: 'name' });
  assert.deepEqual(result.columns, ['id', 'name', 'active']);
  assert.deepEqual(result.rows, [
    { id: 1, name: 'Alice', active: null },
    { id: 2, name: null, active: true }
  ]);
  assert.equal(result.schemaMismatch?.hasMismatch, true);
  assert.deepEqual(result.schemaMismatch?.inputs[1].missing, ['name']);
  assert.deepEqual(result.schemaMismatch?.inputs[1].extra, ['active']);
});

test('Union by position maps equal-width tables and rejects different column counts', () => {
  const first = { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] };
  const second = { columns: ['customer_id', 'customer_name'], rows: [{ customer_id: 2, customer_name: 'Bob' }] };
  const result = DataTableUtils.unionTables([first, second], { mode: 'position' });
  assert.deepEqual(result.columns, ['id', 'name']);
  assert.deepEqual(result.rows, [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
  assert.equal(result.schemaMismatch?.hasMismatch, true);
  assert.throws(
    () => DataTableUtils.unionTables([first, { columns: ['id'], rows: [{ id: 3 }] }], { mode: 'position' }),
    error => error.code === 'UNION_SCHEMA_MISMATCH'
  );
});

test('Group By supports Count, Sum, Average, Min, and Max with multiple aggregates', () => {
  const input = {
    columns: ['category', 'price'],
    rows: [
      { category: 'A', price: '10' },
      { category: 'A', price: '20' },
      { category: 'B', price: '7.5' },
      { category: 'B', price: null },
    ]
  };
  const result = DataTableUtils.groupByAggregate(input, ['category'], [
    { operation: 'count', column: '*', as: 'count' },
    { operation: 'sum', column: 'price', as: 'total_price' },
    { operation: 'average', column: 'price', as: 'avg_price' },
    { operation: 'min', column: 'price', as: 'min_price' },
    { operation: 'max', column: 'price', as: 'max_price' },
  ]);
  assert.deepEqual(result.columns, ['category', 'count', 'total_price', 'avg_price', 'min_price', 'max_price']);
  assert.deepEqual(result.rows, [
    { category: 'A', count: 2, total_price: 30, avg_price: 15, min_price: '10', max_price: '20' },
    { category: 'B', count: 2, total_price: 7.5, avg_price: 7.5, min_price: '7.5', max_price: '7.5' },
  ]);
});

test('Group By can aggregate the whole table without group columns and handles empty input predictably', () => {
  const input = { columns: ['price'], rows: [{ price: '5' }, { price: '' }, { price: null }] };
  const result = DataTableUtils.groupByAggregate(input, [], [
    { operation: 'count', column: '*', as: 'rows' },
    { operation: 'sum', column: 'price', as: 'sum_price' },
    { operation: 'average', column: 'price', as: 'avg_price' },
  ]);
  assert.deepEqual(result.rows, [{ rows: 3, sum_price: 5, avg_price: 5 }]);

  const empty = DataTableUtils.groupByAggregate({ columns: ['price'], rows: [] }, [], [
    { operation: 'count', column: '*', as: 'rows' },
    { operation: 'sum', column: 'price', as: 'sum_price' },
  ]);
  assert.deepEqual(empty.rows, [{ rows: 0, sum_price: null }]);
});

test('Group By rejects incomplete rules, missing columns, duplicate output names, and non-numeric Sum values', () => {
  const input = { columns: ['category', 'price'], rows: [{ category: 'A', price: 'oops' }] };
  assert.throws(
    () => DataTableUtils.groupByAggregate(input, ['missing'], [{ operation: 'count', column: '*', as: 'count' }]),
    error => error?.code === 'COLUMN_NOT_FOUND' && error.column === 'missing'
  );
  assert.throws(
    () => DataTableUtils.groupByAggregate(input, ['category'], [{ operation: 'sum', column: '', as: 'total' }]),
    error => error?.code === 'INVALID_AGGREGATE'
  );
  assert.throws(
    () => DataTableUtils.groupByAggregate(input, ['category'], [{ operation: 'count', column: '*', as: 'category' }]),
    error => error?.code === 'AGGREGATE_NAME_COLLISION' && error.column === 'category'
  );
  assert.throws(
    () => DataTableUtils.groupByAggregate(input, ['category'], [{ operation: 'sum', column: 'price', as: 'total' }]),
    error => error?.code === 'AGGREGATE_NUMERIC_REQUIRED' && error.column === 'price'
  );
});

test('v0.7 JSONL output preserves column order, Null, Date, and BigInt safely', () => {
  const table = {
    columns: ['id', 'name', 'created', 'amount'],
    rows: [
      { id: 1n, name: 'Alice', created: new Date('2026-09-17T01:02:03Z'), amount: null },
      { id: 2n, name: 'Bob', created: null, amount: 12.5 }
    ]
  };
  const jsonl = DataTableUtils.stringifyJsonl(table);
  assert.equal(jsonl, '{"id":"1","name":"Alice","created":"2026-09-17T01:02:03.000Z","amount":null}\n{"id":"2","name":"Bob","created":null,"amount":12.5}\n');
});

test('v0.7 lightweight Parquet writer round-trips flat scalar data with Null values', async () => {
  const ParquetWriteLite = (await import('../src/parquet-write-lite.mjs')).default;
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const source = {
    columns: ['id', 'price', 'active', 'name'],
    rows: [
      { id: 1, price: 12.5, active: true, name: 'Alice' },
      { id: 2, price: null, active: false, name: 'Bob' },
      { id: null, price: 4.25, active: null, name: null }
    ]
  };
  const bytes = ParquetWriteLite.writeParquetTable(source);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'PAR1');
  assert.equal(new TextDecoder().decode(bytes.subarray(bytes.length - 4)), 'PAR1');
  const restored = await ParquetLite.readParquetTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.deepEqual(restored.columns, source.columns);
  assert.deepEqual(restored.rows, source.rows);
});


test('v0.7.1 Parquet writer uses Snappy compression and generic created_by metadata', async () => {
  const ParquetWriteLite = (await import('../src/parquet-write-lite.mjs')).default;
  const ParquetLite = (await import('../src/parquet-lite.mjs')).default;
  const source = {
    columns: ['category', 'value'],
    rows: Array.from({ length: 400 }, (_, i) => ({ category: 'repeated-category-value', value: i % 4 }))
  };
  const bytes = ParquetWriteLite.writeParquetTable(source);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const metadata = await ParquetLite.readMetadata(buffer);
  assert.equal(metadata.created_by, 'Data Pipeline Builder');
  assert.ok(metadata.row_groups[0].columns.every(column => column.meta_data.codec === 'SNAPPY'));
  assert.ok(metadata.row_groups[0].columns.some(column => Number(column.meta_data.total_compressed_size) < Number(column.meta_data.total_uncompressed_size)));
  const restored = await ParquetLite.readParquetTable(buffer);
  assert.deepEqual(restored.rows, source.rows);
});

test('v0.8 Recipe utilities strip input runtime file details but keep output filenames', async () => {
  const RecipeUtils = (await import('../src/recipe-utils.mjs')).default;
  const graph = {
    appId: 'data-pipeline-builder', appSchemaVersion: 1,
    nodes: [
      { id: 'in', type: 'csv-input', position: { x: 1, y: 2 }, data: { delimiter: 'auto', fileName: 'secret.csv', filename: 'secret.csv', file: { name: 'secret.csv' } } },
      { id: 'out', type: 'csv-output', position: { x: 3, y: 4 }, data: { filename: 'result' } }
    ],
    edges: []
  };
  const clean = RecipeUtils.sanitizeGraph(graph);
  assert.equal(clean.nodes[0].data.fileName, undefined);
  assert.equal(clean.nodes[0].data.filename, undefined);
  assert.equal(clean.nodes[0].data.file, undefined);
  assert.equal(clean.nodes[1].data.filename, 'result');
  assert.notEqual(clean, graph);
});

test('v0.8 Pipeline JSON round-trips a sanitized graph and accepts legacy raw graph JSON', async () => {
  const RecipeUtils = (await import('../src/recipe-utils.mjs')).default;
  const graph = { appId: 'data-pipeline-builder', appSchemaVersion: 1, nodes: [{ id: 'a', type: 'csv-input', position: { x: 0, y: 0 }, data: { header: true } }], edges: [] };
  const text = RecipeUtils.stringifyPipeline(graph, { appVersion: '0.8.0' });
  const doc = JSON.parse(text);
  assert.equal(doc.format, 'data-pipeline-builder');
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.appVersion, '0.8.0');
  assert.deepEqual(RecipeUtils.parsePipeline(text), graph);
  assert.deepEqual(RecipeUtils.parsePipeline(JSON.stringify(graph)), graph);
});

test('v0.8 Recipe utilities enumerate required input nodes in graph order', async () => {
  const RecipeUtils = (await import('../src/recipe-utils.mjs')).default;
  const graph = { nodes: [
    { id: 'x', type: 'sort', data: {} },
    { id: 'csv', type: 'csv-input', data: {} },
    { id: 'jsonl', type: 'jsonl-input', data: {} },
    { id: 'pq', type: 'parquet-input', data: {} }
  ], edges: [] };
  assert.deepEqual(RecipeUtils.inputNodes(graph).map(node => node.id), ['csv','jsonl','pq']);
});
