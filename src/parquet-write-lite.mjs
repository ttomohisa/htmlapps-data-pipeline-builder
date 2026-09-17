/*
 * Lightweight Parquet writer for Data Pipeline Builder.
 *
 * Scope: flat local tables, one Snappy-compressed PLAIN data page per column,
 * OPTIONAL primitive columns, compact-Thrift metadata. This intentionally
 * avoids a general database/WASM dependency and matches parquet-lite.mjs.
 */
const ParquetWriteLite=(()=>{
  const enc=new TextEncoder();
  const C={STOP:0,TRUE:1,FALSE:2,BYTE:3,I16:4,I32:5,I64:6,DOUBLE:7,BINARY:8,LIST:9,STRUCT:12};
  const TYPE={BOOLEAN:0,INT32:1,DOUBLE:5,BYTE_ARRAY:6};
  const ENCODING={PLAIN:0,RLE:3};
  const CODEC={UNCOMPRESSED:0,SNAPPY:1};
  const PAGE={DATA_PAGE:0};
  const REP={REQUIRED:0,OPTIONAL:1};
  const CONVERTED={UTF8:0};

  function fail(code,message,extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);throw e}
  function varint(value){let n=BigInt(value);if(n<0n)fail('PARQUET_WRITE_RANGE','Parquet varint cannot be negative.');const out=[];do{let b=Number(n&0x7fn);n>>=7n;if(n)b|=0x80;out.push(b)}while(n);return out}
  function zigzag(value){const n=BigInt(value);return varint((n<<1n)^(n>>63n))}
  function binaryBytes(bytes){return [...varint(bytes.length),...bytes]}
  function binaryText(text){return binaryBytes(enc.encode(String(text)))}
  function field(fid,type,payload,prev){const delta=fid-prev;return {fid,bytes:[...(delta>0&&delta<=15?[(delta<<4)|type]:[type,...zigzag(fid)]),...payload]}}
  function struct(fields){let prev=0;const out=[];for(const item of fields){const f=field(item.id,item.type,item.payload,prev);out.push(...f.bytes);prev=f.fid}out.push(C.STOP);return out}
  function list(type,items){return [...(items.length<15?[(items.length<<4)|type]:[0xf0|type,...varint(items.length)]),...items.flat()]}
  const intField=(id,value,type=C.I32)=>({id,type,payload:zigzag(value)});
  const binField=(id,value)=>({id,type:C.BINARY,payload:binaryText(value)});
  const structField=(id,value)=>({id,type:C.STRUCT,payload:value});
  const listField=(id,type,items)=>({id,type:C.LIST,payload:list(type,items)});

  function uint32(value){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value,true);return [...b]}
  function int32(value){const b=new Uint8Array(4);new DataView(b.buffer).setInt32(0,value,true);return [...b]}
  function double(value){const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,value,true);return [...b]}
  function concat(parts){const size=parts.reduce((n,p)=>n+p.length,0);const out=new Uint8Array(size);let pos=0;for(const part of parts){out.set(part,pos);pos+=part.length}return out}

  function literalTag(length){
    if(length<=0)return [];
    if(length<=60)return [(length-1)<<2];
    let value=length-1;const bytes=[];
    while(value>0){bytes.push(value&255);value=Math.floor(value/256)}
    return [((59+bytes.length)<<2),...bytes];
  }
  function emitLiteral(out,input,start,end){
    const length=end-start;if(length<=0)return;
    out.push(...literalTag(length));
    for(let i=start;i<end;i++)out.push(input[i]);
  }
  function emitCopy(out,offset,length){
    while(length>0){const size=Math.min(64,length);out.push(((size-1)<<2)|2,offset&255,(offset>>>8)&255);length-=size}
  }
  function hash4(input,index){
    const value=(input[index]|(input[index+1]<<8)|(input[index+2]<<16)|(input[index+3]<<24))>>>0;
    return (Math.imul(value,0x1e35a7bd)>>>17)&0x7fff;
  }
  function same4(input,a,b){return input[a]===input[b]&&input[a+1]===input[b+1]&&input[a+2]===input[b+2]&&input[a+3]===input[b+3]}
  function snappyCompress(input){
    const bytes=input instanceof Uint8Array?input:Uint8Array.from(input);
    const out=[...varint(bytes.length)];
    if(bytes.length<4){emitLiteral(out,bytes,0,bytes.length);return Uint8Array.from(out)}
    const table=new Int32Array(1<<15);table.fill(-1);
    let literalStart=0,index=0;
    while(index+4<=bytes.length){
      const hash=hash4(bytes,index),previous=table[hash];table[hash]=index;
      if(previous>=0&&index-previous<=65535&&same4(bytes,previous,index)){
        emitLiteral(out,bytes,literalStart,index);
        let length=4;while(index+length<bytes.length&&bytes[previous+length]===bytes[index+length])length++;
        emitCopy(out,index-previous,length);
        const end=index+length;
        for(let pos=index+1;pos<end&&pos+4<=bytes.length;pos++)table[hash4(bytes,pos)]=pos;
        index=end;literalStart=end;continue;
      }
      index++;
    }
    emitLiteral(out,bytes,literalStart,bytes.length);
    return Uint8Array.from(out);
  }

  function valueKind(value){
    if(value===null||value===undefined)return null;
    if(typeof value==='boolean')return'boolean';
    if(typeof value==='number'&&Number.isFinite(value))return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'int32':'double';
    return'string';
  }
  function mergeKind(a,b){if(!a)return b;if(!b)return a;if(a===b)return a;if((a==='int32'||a==='double')&&(b==='int32'||b==='double'))return'double';return'string'}
  function inferColumn(data,name){let kind=null;for(const row of data.rows||[])kind=mergeKind(kind,valueKind(row?.[name]));return kind||'string'}
  function schemaFor(kind,name){
    if(kind==='boolean')return {name,type:'BOOLEAN',typeId:TYPE.BOOLEAN};
    if(kind==='int32')return {name,type:'INT32',typeId:TYPE.INT32};
    if(kind==='double')return {name,type:'DOUBLE',typeId:TYPE.DOUBLE};
    return {name,type:'BYTE_ARRAY',typeId:TYPE.BYTE_ARRAY,converted:'UTF8'};
  }
  function stringValue(value){
    if(value===null||value===undefined)return'';
    if(value instanceof Date)return value.toISOString();
    if(typeof value==='bigint')return value.toString();
    if(typeof value==='object'){try{return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)}catch{return String(value)}}
    return String(value);
  }
  function plainData(kind,values){
    if(kind==='boolean'){
      const out=new Uint8Array(Math.ceil(values.length/8));
      values.forEach((v,i)=>{if(Boolean(v))out[i>>3]|=1<<(i&7)});
      return [...out];
    }
    if(kind==='int32')return values.flatMap(v=>int32(Number(v)));
    if(kind==='double')return values.flatMap(v=>double(Number(v)));
    const out=[];for(const value of values){const b=enc.encode(stringValue(value));out.push(...uint32(b.length),...b)}return out;
  }
  function encodeDefinitionLevels(values){
    const levels=values.map(v=>v===null||v===undefined?0:1);
    const body=[];
    for(let i=0;i<levels.length;){let j=i+1;while(j<levels.length&&levels[j]===levels[i])j++;body.push(...varint((j-i)<<1),levels[i]);i=j}
    return [...uint32(body.length),...body];
  }
  function makePage(schema,values){
    const present=values.filter(v=>v!==null&&v!==undefined);
    const defs=encodeDefinitionLevels(values);
    const plain=plainData(schema.type==='BOOLEAN'?'boolean':schema.type==='INT32'?'int32':schema.type==='DOUBLE'?'double':'string',present);
    const payload=Uint8Array.from([...defs,...plain]);
    const compressedPayload=snappyCompress(payload);
    const dataHeader=struct([intField(1,values.length),intField(2,ENCODING.PLAIN),intField(3,ENCODING.RLE),intField(4,ENCODING.RLE)]);
    const pageHeader=struct([intField(1,PAGE.DATA_PAGE),intField(2,payload.length),intField(3,compressedPayload.length),structField(5,dataHeader)]);
    return {bytes:concat([Uint8Array.from(pageHeader),compressedPayload]),uncompressed:pageHeader.length+payload.length,compressed:pageHeader.length+compressedPayload.length};
  }
  function schemaElement(column){
    const fields=[intField(1,column.typeId),intField(3,REP.OPTIONAL),binField(4,column.name)];
    if(column.converted==='UTF8')fields.push(intField(6,CONVERTED.UTF8));
    return struct(fields);
  }

  function writeParquetTable(data){
    const columns=Array.isArray(data?.columns)?data.columns.map(String):[];
    const rows=Array.isArray(data?.rows)?data.rows:[];
    if(new Set(columns).size!==columns.length)fail('PARQUET_WRITE_COLUMNS','Parquet output requires unique column names.');
    const schemas=columns.map(name=>schemaFor(inferColumn({rows},name),name));
    const fileParts=[Uint8Array.from([0x50,0x41,0x52,0x31])];
    let offset=4;
    const chunks=[];
    if(rows.length){
      for(const schema of schemas){
        const values=rows.map(row=>row?.[schema.name]??null);
        const page=makePage(schema,values);
        const start=offset;
        fileParts.push(page.bytes);offset+=page.bytes.length;
        const meta=struct([
          intField(1,schema.typeId),
          listField(2,C.I32,[zigzag(ENCODING.PLAIN),zigzag(ENCODING.RLE)]),
          listField(3,C.BINARY,[binaryText(schema.name)]),
          intField(4,CODEC.SNAPPY),
          intField(5,rows.length,C.I64),
          intField(6,page.uncompressed,C.I64),
          intField(7,page.compressed,C.I64),
          intField(9,start,C.I64)
        ]);
        chunks.push({bytes:struct([intField(2,start,C.I64),structField(3,meta)]),size:page.bytes.length});
      }
    }
    const rootSchema=struct([binField(4,'schema'),intField(5,schemas.length)]);
    const schemaItems=[rootSchema,...schemas.map(schemaElement)];
    const rowGroups=rows.length?[struct([
      listField(1,C.STRUCT,chunks.map(c=>c.bytes)),
      intField(2,chunks.reduce((n,c)=>n+c.size,0),C.I64),
      intField(3,rows.length,C.I64),
      intField(6,chunks.reduce((n,c)=>n+c.size,0),C.I64)
    ])]:[];
    const metadata=Uint8Array.from(struct([
      intField(1,1),
      listField(2,C.STRUCT,schemaItems),
      intField(3,rows.length,C.I64),
      listField(4,C.STRUCT,rowGroups),
      binField(6,'Data Pipeline Builder')
    ]));
    const footer=new Uint8Array(8);new DataView(footer.buffer).setUint32(0,metadata.length,true);footer.set([0x50,0x41,0x52,0x31],4);
    return concat([...fileParts,metadata,footer]);
  }

  return Object.freeze({writeParquetTable});
})();
if(typeof window!=='undefined')window.ParquetWriteLite=ParquetWriteLite;
export default ParquetWriteLite;
