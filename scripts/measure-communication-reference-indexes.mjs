import assert from 'node:assert/strict'
import { createReferenceFixture } from './validate-communication-references-sql.mjs'
import { id,workspace } from './validate-workspace-search-capability.mjs'
const {db,query}=await createReferenceFixture()
const indexes=['comms_reference_work_name_idx','comms_reference_asset_name_idx','comms_reference_relationship_name_idx','comms_reference_relationship_business_idx','comms_reference_relationship_recent_idx']
try {
    await query("insert into workspaces(id,slug,name)values($1,'measure','Measure')",[workspace])
    for(const [table,column,offset]of [['work_items','title',10000],['assets','title',40000],['relationships','primary_person_name',70000]]) {
        await query(`insert into ${table}(id,workspace_id,${column})select('00000000-0000-4000-8000-'||lpad(($2+n)::text,12,'0'))::uuid,$1,'Measured record '||n from generate_series(1,20000)n`,[workspace,offset])
    }
    const cases=[['work_items','title',id(10001)],['assets','title',id(40001)],['relationships','primary_person_name',id(70001)]]
    const measurements=[]
    const sample=async(hasIndexes,pass)=>{
        await db.exec('begin')
        try {
            if(!hasIndexes)for(const name of indexes)await db.exec(`drop index ${name}`)
            for(const[table,column,recordId]of cases)for(let n=0;n<30;n++) {
                await db.exec('savepoint sample')
                const result=await query(`explain(analyze,format json)update ${table} set ${column}=$1,updated_at=clock_timestamp()where id=$2`,[`Renamed record ${n}`,recordId])
                const ms=result.rows[0]['QUERY PLAN'][0]['Execution Time']
                assert.ok(ms>=0)
                if(n>=5)measurements.push({table,hasIndexes,pass,ms})
                await db.exec('rollback to sample')
            }
        }finally{await db.exec('rollback')}
    }
    for(let pass=0;pass<4;pass++)for(const hasIndexes of pass%2?[true,false]:[false,true])await sample(hasIndexes,pass)
    const percentile=(rows,p)=>rows.sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1]
    const result=cases.map(([table])=>({table,...Object.fromEntries([false,true].map(hasIndexes=>{const rows=measurements.filter(row=>row.table===table&&row.hasIndexes===hasIndexes).map(row=>row.ms);return [hasIndexes?'withReferenceIndexes':'baseline',{samples:rows.length,medianMs:percentile([...rows],.5),p95Ms:percentile([...rows],.95)}]}))}))
    const sizes=(await query("select relname,pg_relation_size(oid) bytes from pg_class where relname like 'comms_reference_%' order by relname")).rows
    console.log(JSON.stringify({engine:'PGlite PostgreSQL',rowsPerTable:20000,measurements:result,indexBytes:sizes,limits:'Isolated warm single-record UPDATE EXPLAIN timings, alternated baseline/candidate passes, no network/auth/concurrent load or provider work. Added name-index maintenance is measured here; these are not end-to-end latency claims. No production calls.'},null,2))
}finally{await db.close()}
