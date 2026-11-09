import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaRuntime, evaluateFileReport } from '../dist/index.js';

const observed = (result, coverage) => ({ requested: true, status: 'completed', result, coverage, complete: true, reason: 'observed' });
const skipped = { requested: false, status: 'not_run', result: null, coverage: 'none', complete: false, reason: 'not_requested' };
function raw(format = 'jpeg') {
  return { job_id: 'job_a', status: 'available', report: {
    report_version: '1', inspection_status: 'complete', profile: { id: 'file_inspection_v1', version: '1', tier: 'standard', deep_validation: false },
    attempt_id: 'a'.repeat(32), started_at: 1, completed_at: 2,
    file: { size_bytes: 42, sha256: 'a'.repeat(64), detected_format: format, detected_mime: 'image/jpeg', ambiguous: false },
    scanner: { engine: 'ClamAV', version: '1.4.3', database_sha256: 'b'.repeat(64), database_version: 1, database_built_at: 1, max_file_bytes: 100, max_scan_bytes: 200 },
    checks: { identification: observed('identified', 'signature'), malware: observed('no_threat_detected', 'antivirus'),
      structure: observed('valid', 'image_verify'), archive: skipped, deep_validation: skipped, sanitization: skipped },
    findings: [], findings_truncated: false, archive: null, sanitization: null,
  } };
}
const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
test('quote exposes the pinned unsupported-sanitization rate without deciding settlement', async () => {
  const quote = { pricing_version: 'inspection-v2', profile: { ...raw().report.profile, tier: 'premium', deep_validation: true, sanitization: 'jpeg' },
    currency: 'USD', unit_bytes: 67108864, base_cents: 49, unit_rate_cents: 1, max_input_bytes: 200,
    quoted_amount_cents: 50, limits: {}, unsupported_sanitization_rate: { unit_bytes: 67108864, base_cents: 39, unit_rate_cents: 1 } };
  const parsed = await client(async () => reply(quote)).jobs.estimateSecurity({ enabled: true });
  assert.equal(parsed.quotedAmountCents, 50);
  assert.deepEqual(parsed.unsupportedSanitizationRate, { unitBytes: 67108864, baseCents: 39, unitRateCents: 1 });
  for (const value of [0, true, 50]) {
    quote.unsupported_sanitization_rate.base_cents = value;
    await assert.rejects(client(async () => reply(quote)).jobs.estimateSecurity({ enabled: true }), /Invalid file inspection response/);
  }
});
function client(fetch) { return new MediaRuntime({ apiKey: 'fixture', baseUrl: 'https://api.example.test', fetch }); }
async function report(value = raw()) { return client(async () => reply(value)).jobs.getSecurityReport('job_a'); }

test('report parsing and JPEG alias policy are separate from API submission', async () => {
  const result = await report();
  assert.equal(result.report.file.detectedFormat, 'jpeg');
  assert.deepEqual(evaluateFileReport(result, { allowedFormats: ['png', 'jpg'] }), { accepted: true, reasons: [] });
  assert.equal(evaluateFileReport(result, { allowedFormats: ['upload.jpg'] }).accepted, false);
  assert.equal(evaluateFileReport(result, { allowedFormats: ['zip'] }).accepted, false);
});
test('missing, ambiguous, unknown versions and detected threats fail closed', async () => {
  for (const mutate of [
    r => { r.report.file.ambiguous = true; },
    r => { r.report.checks.malware = { ...skipped, result: 'detected' }; },
    r => { r.report.checks.structure = skipped; r.report.inspection_status = 'incomplete'; },
    r => { r.report.findings_truncated = true; },
  ]) {
    const value = raw(); mutate(value);
    assert.equal(evaluateFileReport(await report(value), { allowedFormats: ['jpg'] }).accepted, false);
  }
  const unknown = raw(); unknown.report.report_version = '2';
  await assert.rejects(report(unknown), /Invalid file inspection response/);
  assert.equal(evaluateFileReport({}, { allowedFormats: ['jpg'] }).accepted, false);
  assert.equal(evaluateFileReport({ ...(await report()).report, checks: {} }, { allowedFormats: ['jpg'] }).accepted, false);
});
test('pending reports are typed and unknown optional fields are omitted', async () => {
  assert.deepEqual(await report({ job_id: 'job_a', status: 'pending', report: null }), { jobId: 'job_a', status: 'pending', report: null });
  const value = raw(); value.report.extra = { unsafe: 'ignored' };
  assert.equal('extra' in (await report(value)).report, false);
});
test('a requested scan age cannot be bypassed by a non-finite or missing timestamp', async () => {
  const parsed = (await report()).report;
  for (const completedAt of [NaN, Infinity, undefined, -1, 1, Date.now() / 1000 + 60]) {
    const decision = evaluateFileReport({ ...parsed, completedAt }, { allowedFormats: ['jpg'], maxScanAgeSeconds: 3600 });
    assert.equal(decision.accepted, false);
    assert.ok(decision.reasons.includes('scan_age_exceeded'));
  }
  assert.equal(evaluateFileReport({ ...parsed, completedAt: Math.floor(Date.now() / 1000) },
    { allowedFormats: ['jpg'], maxScanAgeSeconds: 3600 }).accepted, true);
});
test('all-entry ZIP policy cannot accept truncated or incomplete evidence', async () => {
  const value = raw('zip'); value.report.checks.archive = observed('inspected', 'zip_entries');
  value.report.archive = { entries_total: 1, entries_inspected: 1, expanded_bytes: 10, entries_complete: true, entries_truncated: false,
    entries: [{ index: 0, depth: 0, name: '<script>fixture</script>', compressed_bytes: 8, expanded_bytes: 10, detected_format: 'jpeg', encrypted: false, checks: raw().report.checks }] };
  const policy = { allowedFormats: ['zip'], archiveEntryFormats: ['png', 'jpg'] };
  assert.equal(evaluateFileReport(await report(value), policy).accepted, true);
  value.report.archive.entries_truncated = true;
  assert.equal(evaluateFileReport(await report(value), policy).accepted, false);
  value.report.archive.entries_truncated = false; value.report.archive.entries[0].encrypted = true;
  assert.equal(evaluateFileReport(await report(value), policy).accepted, false);
});
test('inspection-only wire preserves quote and excludes application policy', async () => {
  const calls = [];
  const quote = { pricing_version: 'fixture', profile: raw().report.profile, currency: 'USD', unit_bytes: 100,
    base_cents: 1, unit_rate_cents: 2, max_input_bytes: 200, quoted_amount_cents: 5, limits: { entries: 16 } };
  const api = client(async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return reply(String(url).endsWith('/estimate') ? quote : { job_id: 'job_a', status: 'QUEUED', tier: 'standard', inspection_quote: quote }); });
  const estimated = await api.jobs.estimateSecurity({ enabled: true, maxInputBytes: 200 });
  const job = await api.jobs.create({ source: 'https://example.test/a', outputs: [], security: { enabled: true, maxInputBytes: 200,
    pricingVersion: estimated.pricingVersion, maxChargeCents: estimated.quotedAmountCents } });
  assert.equal(job.inspectionQuote.quotedAmountCents, 5);
  assert.deepEqual(calls[1].body.security, { enabled: true, max_input_bytes: 200, pricing_version: 'fixture', max_charge_cents: 5 });
  await assert.rejects(api.jobs.create({ source: 'https://example.test/a', outputs: [], security: { enabled: true, allowedFormats: ['jpg'] } }));
  assert.equal(calls.length, 2);
});
test('disabled server response never falls back to ordinary processing', async () => {
  const calls = [];
  const api = client(async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ detail: 'Inspection disabled' }), { status: 503 }); });
  await assert.rejects(api.jobs.create({ source: 'https://example.test/a', outputs: [], security: { enabled: true } }));
  assert.equal(calls.length, 3); // Existing bounded idempotent submission retries.
  assert.equal(calls.every(c => c.url.endsWith('/jobs') && c.body.security.enabled && c.body.outputs.length === 0), true);
});

test('strict ZIP policy rejects legacy and revised incomplete archive reports', async () => {
  for (const legacy of [true, false]) {
    const value = raw('zip');
    value.report.inspection_status = 'incomplete';
    value.report.profile.deep_validation = true;
    value.report.checks.structure = { ...observed('malformed', 'zip_entries'), reason: 'malformed_data' };
    value.report.checks.archive = { ...observed('inspected', 'zip_entries'), complete: false };
    value.report.checks.deep_validation = { ...observed(legacy ? 'valid' : 'not_validated', legacy ? 'full_decode' : 'zip_entries'), complete: false };
    if (!legacy) value.report.checks.malware = { ...observed('no_threat_detected', 'antivirus_partial'), complete: false };
    value.report.archive = { entries_total: 1, entries_inspected: 1, expanded_bytes: 0, entries_complete: false, entries_truncated: false, entries: [] };
    value.report.findings = [{ code: 'malformed_data', check: 'archive', entry_index: 0 }];
    const parsed = await report(value);
    assert.equal(parsed.report.checks.deep_validation.result, legacy ? 'valid' : 'not_validated');
    assert.equal(parsed.report.checks.malware.result, 'no_threat_detected');
    assert.equal(parsed.report.archive.entriesInspected, parsed.report.archive.entriesTotal);
    for (const requireDeepValidation of [false, true]) {
      const decision = evaluateFileReport(parsed, { allowedFormats: ['zip'], requireCompleteInspection: true, requireValidStructure: true, requireMalwareScan: true, requireDeepValidation });
      assert.equal(decision.accepted, false);
      for (const reason of ['inspection_incomplete', 'structure_not_valid', 'malformed_data']) assert.ok(decision.reasons.includes(reason));
      if (requireDeepValidation) assert.ok(decision.reasons.includes('deep_validation_missing'));
      if (!legacy) assert.ok(decision.reasons.includes('malware_evidence_missing'));
      assert.equal(decision.reasons.includes('threat_detected'), false);
    }
  }
});

test('CRC findings reject the archive without claiming malware was detected', async () => {
  const value = raw('zip');
  value.report.inspection_status = 'incomplete';
  value.report.checks.structure = { ...observed('malformed', 'zip_entries'), reason: 'malformed_data' };
  value.report.checks.malware = { ...observed('no_threat_detected', 'antivirus_partial'), complete: false };
  value.report.findings = [{ code: 'archive_crc_mismatch', check: 'archive', entry_index: 0 }];
  const parsed = await report(value);
  const decision = evaluateFileReport(parsed, { allowedFormats: ['zip'] });
  assert.equal(decision.accepted, false);
  for (const reason of ['archive_crc_mismatch', 'structure_not_valid', 'inspection_incomplete', 'malware_evidence_missing']) assert.ok(decision.reasons.includes(reason));
  assert.equal(decision.reasons.includes('threat_detected'), false);
});

for (const code of ['archive_decompression_failed', 'archive_structure_invalid']) {
  test(`${code} is preserved and rejects an archive`, async () => {
    const value = raw('zip');
    value.report.archive = { entries_total: 1, entries_inspected: 1, entries_attempted: 1, entries_fully_inspected: 0, entries_complete: false, expanded_bytes: 0, entries_truncated: false, entries: [] };
    value.report.findings = [{ code, check: 'archive', entry_index: 0 }];
    const parsed = await report(value);
    assert.equal(parsed.report.archive.entriesAttempted, 1);
    assert.equal(parsed.report.archive.entriesFullyInspected, 0);
    const decision = evaluateFileReport(parsed, { allowedFormats: ['zip'] });
    assert.equal(decision.accepted, false);
    assert.ok(decision.reasons.includes(code));
  });
}


test('failed sanitization prerequisites remain explicit and cannot satisfy derivative policy', async () => {
  for (const reason of ['structural_validation_failed', 'deep_validation_failed', 'short_circuit']) {
    const value = raw('png');
    value.report.inspection_status = 'incomplete';
    value.report.checks.sanitization = { ...skipped, requested: true, reason };
    const parsed = await report(value);
    assert.equal(parsed.report.checks.sanitization.reason, reason);
    assert.equal(parsed.report.checks.sanitization.status, 'not_run');
    assert.equal(evaluateFileReport(parsed, { allowedFormats: ['png'], requireSanitizedDerivative: true }).accepted, false);
  }
});


test('PNG chunk CRC diagnostics are retained and rejected by SDK policy', async () => {
  const value = raw('png');
  value.report.findings = [{ code: 'png_chunk_crc_mismatch', check: 'structure', chunk: 'IHDR', message: 'PNG image header failed CRC-32 verification' }];
  const parsed = await report(value);
  assert.equal(parsed.report.findings[0].chunk, 'IHDR');
  assert.equal(parsed.report.findings[0].message, value.report.findings[0].message);
  assert.ok(evaluateFileReport(parsed, { allowedFormats: ['png'] }).reasons.includes('png_chunk_crc_mismatch'));
  value.report.findings[0].chunk = '<script>';
  await assert.rejects(report(value), /Invalid file inspection response/);
});

for (const code of ['jpeg_segment_length_invalid','jpeg_segment_truncated','jpeg_end_marker_missing','jpeg_frame_header_missing',
  'png_chunk_truncated','png_ihdr_length_invalid','png_duplicate_chunk','png_chunk_order_invalid','png_required_chunk_missing',
  'webp_riff_size_mismatch','webp_chunk_truncated','webp_chunk_padding_invalid','webp_extended_header_invalid','webp_image_data_missing']) {
  test(`${code} retains byte and entry diagnostics and rejects malformed content`, async () => {
    const value = raw('zip');
    value.report.findings = [{ code, check: 'archive', entry_index: 0, byte_offset: 29, chunk: 'VP8 ', marker: 'FFE0' }];
    const parsed = await report(value);
    assert.deepEqual(parsed.report.findings[0], { code, check: 'archive', entryIndex: 0, byteOffset: 29, chunk: 'VP8 ', marker: 'FFE0' });
    const decision = evaluateFileReport(parsed, { allowedFormats: ['zip'] });
    assert.equal(decision.accepted, false);
    assert.ok(decision.reasons.includes(code));
    assert.equal(decision.reasons.includes('threat_detected'), false);
  });
}
test('diagnostic offsets and markers are bounded', async () => {
  for (const extra of [{byte_offset:-1},{byte_offset:536870913},{marker:'<bad'}]) {
    const value=raw(); value.report.findings=[{code:'malformed_data',check:'structure',...extra}];
    await assert.rejects(report(value), /Invalid file inspection response/);
  }
});

for (const code of ["wav_riff_size_mismatch", "wav_chunk_truncated", "wav_required_chunk_missing", "wav_format_invalid", "wav_adpcm_block_invalid", "id3_header_invalid", "id3_tag_truncated", "mp3_frame_header_invalid", "mp3_frame_truncated", "flac_streaminfo_invalid", "flac_metadata_truncated", "flac_streaminfo_missing", "ogg_page_crc_mismatch", "ogg_page_truncated", "ogg_page_sequence_invalid", "ogg_end_marker_missing", "aac_frame_length_invalid", "aac_frame_truncated", "aac_frame_header_invalid", "mp4_box_size_invalid", "mp4_box_truncated", "mp4_required_box_missing"]) {
  test(`${code} preserves audio byte and entry diagnostics`, async () => {
    const value=raw('zip');
    value.report.findings=[{code,check:'archive',entry_index:1,byte_offset:42}];
    const parsed=await report(value);
    assert.deepEqual(parsed.report.findings[0],{code,check:'archive',entryIndex:1,byteOffset:42});
    const decision=evaluateFileReport(parsed,{allowedFormats:['zip']});
    assert.equal(decision.accepted,false);
    assert.ok(decision.reasons.includes(code));
    assert.equal(decision.reasons.includes('threat_detected'),false);
  });
}
for (const format of ['aiff','caf']) {
  test(`${format} remains identifiable with explicitly unsupported validation`, async () => {
    const value=raw(format);value.report.inspection_status='incomplete';
    value.report.checks.structure={...skipped,requested:true,status:'unsupported',reason:'unsupported_format'};
    const parsed=await report(value);
    assert.equal(parsed.report.file.detectedFormat,format);
    assert.equal(evaluateFileReport(parsed,{allowedFormats:[format]}).accepted,false);
  });
}
