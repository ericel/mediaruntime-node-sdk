import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MediaRuntime, evaluateFileReport } from '../dist/index.js';

const root=process.env.MEDIA_SECURITY_AUDIO_RUN;
test('actual audio fixture reports preserve diagnostics and satisfy strict policy expectations', {skip:!root}, async()=>{
  const manifest=JSON.parse(readFileSync(join(root,'corpus/manifest.json'),'utf8'));
  let checked=0;
  for(const name of readdirSync(join(root,'api'))){
    const folder=join(root,'api',name);
    let row;
    try{row=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));}catch{continue;}
    assert.deepEqual(row.issues,[],name);
    const raw=JSON.parse(readFileSync(join(folder,'report.json'),'utf8'));
    const api=new MediaRuntime({apiKey:'local-fixture',baseUrl:'https://fixture.invalid',
      fetch:async()=>new Response(JSON.stringify(raw),{status:200,headers:{'Content-Type':'application/json'}})});
    const parsed=await api.jobs.getSecurityReport(raw.job_id);
    assert.equal(parsed.report.file.sha256,raw.report.file.sha256);
    assert.deepEqual(parsed.report.findings,raw.report.findings.map(f=>({code:f.code,check:f.check,entryIndex:f.entry_index??null,
      ...(f.chunk==null?{}:{chunk:f.chunk}),...(f.marker==null?{}:{marker:f.marker}),
      ...(f.byte_offset==null?{}:{byteOffset:f.byte_offset}),...(f.message==null?{}:{message:f.message})})),name);
    const fixture=manifest.fixtures.find(f=>f.file===row.fixture);
    const policy={allowedFormats:[fixture.expected.detected_format],requireCompleteInspection:true,
      requireDeepValidation:true,requireValidStructure:true,requireMalwareScan:true};
    if(fixture.expected.detected_format==='zip')policy.archiveEntryFormats=['wav','mp3','flac','ogg','aac','mp4'];
    // Declaration cases intentionally request the other audio format. The API
    // reports actual format; application format policy stays in the consumer.
    if(fixture.category==='declaration')policy.allowedFormats=[fixture.mutation.target==='mime'
      ?({'audio/mpeg':'mp3','audio/mp4':'mp4'}[fixture.mutation.declared_mime]||fixture.mutation.declared_mime.split('/')[1]):fixture.file.split('.').at(-1)];
    const decision=evaluateFileReport(parsed,policy);
    assert.equal(decision.accepted,row.tier==='premium'&&!row.sanitization&&fixture.expected.strict_policy_accepts,name+': '+decision.reasons);
    assert.equal(decision.reasons.includes('threat_detected'),false,name);
    checked++;
  }
  assert.equal(checked,314,'Expected the complete inspection, enforcement and repeated-run matrix');
});
