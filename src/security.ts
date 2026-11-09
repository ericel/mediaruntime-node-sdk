import { ValidationError } from './errors.js';

export interface SecurityOptions {
  pricingVersion?: string;
  maxChargeCents?: number;
  enabled: boolean;
  profile?: 'file_inspection_v1';
  mode?: 'inspect' | 'enforce';
  tier?: 'standard' | 'premium';
  maxInputBytes?: number;
  deepValidation?: boolean;
  sanitization?: 'png' | 'jpeg';
  suppliedFilename?: string;
  declaredMime?: string;
}
export interface InspectionProfile {
  id: 'file_inspection_v1'; version: '1'; tier: 'standard' | 'premium';
  deepValidation: boolean; sanitization: 'png' | 'jpeg' | null;
}
export interface InspectionQuote {
  pricingVersion: string; profile: InspectionProfile; currency: 'USD'; unitBytes: number;
  baseCents: number; unitRateCents: number; maxInputBytes: number; quotedAmountCents: number;
  limits: Record<string, number>;
  unsupportedSanitizationRate?: { unitBytes: number; baseCents: number; unitRateCents: number };
}
export interface InspectionCheck {
  requested: boolean; status: 'completed' | 'error' | 'unsupported' | 'not_run';
  result: string | null; reason: string; coverage: string; complete: boolean;
}
export type InspectionChecks = Record<'identification' | 'malware' | 'structure' | 'deep_validation' | 'archive' | 'sanitization', InspectionCheck>;
export interface SecurityReport {
  reportVersion: '1'; inspectionStatus: 'complete' | 'incomplete'; profile: InspectionProfile;
  attemptId: string; startedAt: number; completedAt: number;
  file: { sizeBytes: number; sha256: string; detectedFormat: string; detectedMime: string; ambiguous: boolean;
    suppliedFilename: string | null; declaredMime: string | null; declarationsUntrusted: true } | null;
  scanner: { engine: 'ClamAV'; version: string; databaseSha256: string; databaseVersion: number;
    databaseBuiltAt: number; maxFileBytes: number; maxScanBytes: number } | null;
  checks: InspectionChecks;
  archive: { entriesTotal: number;
    /** Entries attempted, including pre-decode rejections; not a count of fully inspected or safe entries. */
    entriesInspected: number; entriesAttempted?: number; entriesFullyInspected?: number; expandedBytes: number;
    entriesComplete: boolean; entriesTruncated: boolean; entries: Array<{
      index: number; depth: number; name: string; compressedBytes: number; expandedBytes: number;
      detectedFormat: string; encrypted: boolean; checks: InspectionChecks;
    }> } | null;
  findings: Array<{ code: string; check: string; entryIndex: number | null; chunk?: string; message?: string; marker?: string; byteOffset?: number }>;
  findingsTruncated: boolean;
  sanitization: { recipe: 'image_reencode_v1'; format: 'png' | 'jpeg'; sourceSha256: string;
    sha256: string; sizeBytes: number; metadataRemoved: true; reinspectionCompleted: true } | null;
}
export interface SecurityReportResult { jobId: string; status: 'pending' | 'available'; report: SecurityReport | null }
export interface FileReportPolicy {
  allowedFormats: string[];
  requireCompleteInspection?: boolean;
  requireValidStructure?: boolean;
  requireMalwareScan?: boolean;
  requireDeepValidation?: boolean;
  archiveEntryFormats?: string[];
  requireSanitizedDerivative?: boolean;
  maxScanAgeSeconds?: number;
}
export interface FileReportDecision { accepted: boolean; reasons: string[] }

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const invalid = (): never => { throw new ValidationError('Invalid file inspection response', { status: 502, code: 'invalid_security_report', field: 'security' }); };
const text = (v: unknown, max = 128): string => typeof v === 'string' && v.length <= max ? v : invalid();
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : invalid();
const boolean = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const digest = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : invalid();
const code = (v: unknown): string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v) ? v : invalid();
const nullableText = (v: unknown): string | null => v == null ? null : text(v);
const checkNames = ['identification', 'malware', 'structure', 'deep_validation', 'archive', 'sanitization'] as const;
function profile(v: unknown): InspectionProfile {
  const p = object(v);
  if (p.id !== 'file_inspection_v1' || p.version !== '1' || !['standard', 'premium'].includes(String(p.tier))) return invalid();
  if (p.sanitization != null && !['png', 'jpeg'].includes(String(p.sanitization))) return invalid();
  return { id: 'file_inspection_v1', version: '1', tier: p.tier as InspectionProfile['tier'],
    deepValidation: boolean(p.deep_validation), sanitization: p.sanitization == null ? null : p.sanitization as 'png' | 'jpeg' };
}
function parseChecks(v: unknown): InspectionChecks {
  const values = object(v);
  return Object.fromEntries(checkNames.map(name => {
    const c = object(values[name]);
    if (!['completed', 'error', 'unsupported', 'not_run'].includes(String(c.status))) return invalid();
    return [name, { requested: boolean(c.requested), status: c.status, result: c.result == null ? null : code(c.result),
      reason: code(c.reason), coverage: code(c.coverage), complete: boolean(c.complete) }];
  })) as InspectionChecks;
}
export function parseInspectionQuote(value: unknown): InspectionQuote {
  const q = object(value);
  if (q.currency !== 'USD') return invalid();
  if ([q.unit_bytes, q.base_cents, q.unit_rate_cents, q.max_input_bytes, q.quoted_amount_cents].some(v => number(v) < 1)) return invalid();
  const fallback = q.unsupported_sanitization_rate == null ? undefined : object(q.unsupported_sanitization_rate);
  if (fallback && ([fallback.unit_bytes, fallback.base_cents, fallback.unit_rate_cents].some(v => number(v) < 1)
    || fallback.unit_bytes !== q.unit_bytes || number(fallback.base_cents) > number(q.base_cents)
    || number(fallback.unit_rate_cents) > number(q.unit_rate_cents))) return invalid();
  return { pricingVersion: text(q.pricing_version, 64), profile: profile(q.profile), currency: 'USD',
    unitBytes: number(q.unit_bytes), baseCents: number(q.base_cents), unitRateCents: number(q.unit_rate_cents),
    maxInputBytes: number(q.max_input_bytes, 536870912), quotedAmountCents: number(q.quoted_amount_cents, 10000000),
    limits: Object.fromEntries(Object.entries(object(q.limits)).map(([k, v]) => [code(k), number(v)])),
    ...(fallback ? { unsupportedSanitizationRate: { unitBytes: number(fallback.unit_bytes),
      baseCents: number(fallback.base_cents), unitRateCents: number(fallback.unit_rate_cents) } } : {}) };
}
export function parseSecurityReport(value: unknown): SecurityReportResult {
  const envelope = object(value), jobId = text(envelope.job_id);
  if (envelope.status === 'pending' && envelope.report == null) return { jobId, status: 'pending', report: null };
  if (envelope.status !== 'available') return invalid();
  const r = object(envelope.report), f = object(r.file), s = object(r.scanner), a = object(r.archive), d = object(r.sanitization);
  if (r.report_version !== '1' || !['complete', 'incomplete'].includes(String(r.inspection_status))) return invalid();
  if (!Array.isArray(r.findings) || r.findings.length > 64) return invalid();
  if (r.archive != null && (!Array.isArray(a.entries) || a.entries.length > 32)) return invalid();
  if (r.scanner != null && s.engine !== 'ClamAV') return invalid();
  if (r.sanitization != null && (d.recipe !== 'image_reencode_v1' || !['png', 'jpeg'].includes(String(d.format)) || d.metadata_removed !== true || d.reinspection_completed !== true)) return invalid();
  const report: SecurityReport = {
    reportVersion: '1', inspectionStatus: r.inspection_status as SecurityReport['inspectionStatus'], profile: profile(r.profile),
    attemptId: text(r.attempt_id, 32), startedAt: number(r.started_at), completedAt: number(r.completed_at), checks: parseChecks(r.checks),
    file: r.file == null ? null : { sizeBytes: number(f.size_bytes, 536870912), sha256: digest(f.sha256),
      detectedFormat: code(f.detected_format), detectedMime: text(f.detected_mime, 96), ambiguous: boolean(f.ambiguous),
      suppliedFilename: nullableText(f.supplied_filename), declaredMime: nullableText(f.declared_mime), declarationsUntrusted: true },
    scanner: r.scanner == null ? null : { engine: 'ClamAV', version: text(s.version, 24), databaseSha256: digest(s.database_sha256),
      databaseVersion: number(s.database_version), databaseBuiltAt: number(s.database_built_at),
      maxFileBytes: number(s.max_file_bytes), maxScanBytes: number(s.max_scan_bytes) },
    archive: r.archive == null ? null : { entriesTotal: number(a.entries_total), entriesInspected: number(a.entries_inspected),
      ...(a.entries_attempted == null ? {} : { entriesAttempted: number(a.entries_attempted) }),
      ...(a.entries_fully_inspected == null ? {} : { entriesFullyInspected: number(a.entries_fully_inspected) }),
      expandedBytes: number(a.expanded_bytes), entriesComplete: boolean(a.entries_complete), entriesTruncated: boolean(a.entries_truncated),
      entries: (a.entries as unknown[]).map(raw => { const e = object(raw); return { index: number(e.index), depth: number(e.depth, 2),
        name: text(e.name), compressedBytes: number(e.compressed_bytes), expandedBytes: number(e.expanded_bytes),
        detectedFormat: code(e.detected_format), encrypted: boolean(e.encrypted), checks: parseChecks(e.checks) }; }) },
    findings: r.findings.map(raw => { const finding = object(raw); return { code: code(finding.code), check: code(finding.check),
      entryIndex: finding.entry_index == null ? null : number(finding.entry_index, 256),
      ...(finding.chunk == null ? {} : { chunk: typeof finding.chunk === 'string' && /^[A-Za-z0-9 ]{4}$/.test(finding.chunk) ? finding.chunk : invalid() }),
      ...(finding.message == null ? {} : { message: text(finding.message, 160) }),
      ...(finding.marker == null ? {} : { marker: typeof finding.marker === 'string' && /^FF[A-F0-9]{2}$/.test(finding.marker) ? finding.marker : invalid() }),
      ...(finding.byte_offset == null ? {} : { byteOffset: number(finding.byte_offset, 536870912) }) }; }),
    findingsTruncated: boolean(r.findings_truncated),
    sanitization: r.sanitization == null ? null : { recipe: 'image_reencode_v1', format: d.format as 'png' | 'jpeg',
      sourceSha256: digest(d.source_sha256), sha256: digest(d.sha256), sizeBytes: number(d.size_bytes, 4194304),
      metadataRemoved: true, reinspectionCompleted: true },
  };
  return { jobId, status: 'available', report };
}
export function serializeSecurity(options: SecurityOptions): Obj {
  const allowed = ['enabled', 'profile', 'mode', 'tier', 'maxInputBytes', 'deepValidation', 'sanitization', 'suppliedFilename', 'declaredMime', 'pricingVersion', 'maxChargeCents'];
  if (!options || typeof options.enabled !== 'boolean' || Object.keys(options).some(k => !allowed.includes(k))) {
    throw new ValidationError('Invalid security options', { status: 400, field: 'security' });
  }
  if ((options.mode !== undefined && !['inspect', 'enforce'].includes(options.mode)) ||
      (options.profile !== undefined && options.profile !== 'file_inspection_v1') ||
      (options.tier !== undefined && !['standard', 'premium'].includes(options.tier)) ||
      (options.deepValidation !== undefined && typeof options.deepValidation !== 'boolean') ||
      (options.maxInputBytes !== undefined && (!Number.isSafeInteger(options.maxInputBytes) || options.maxInputBytes < 1 || options.maxInputBytes > 536870912)) ||
      (options.sanitization != null && !['png', 'jpeg'].includes(options.sanitization))) {
    throw new ValidationError('Invalid inspection profile or limits', { status: 400, field: 'security' });
  }
  if ((options.suppliedFilename !== undefined && (typeof options.suppliedFilename !== 'string' || options.suppliedFilename.length > 128 || /[\x00-\x1f\x7f/\\]/.test(options.suppliedFilename))) ||
      (options.declaredMime !== undefined && (typeof options.declaredMime !== 'string' || options.declaredMime.length > 96 || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(options.declaredMime))) ||
      (options.maxChargeCents !== undefined && (!Number.isSafeInteger(options.maxChargeCents) || options.maxChargeCents < 1 || options.maxChargeCents > 10000000)) ||
      (options.pricingVersion !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/.test(options.pricingVersion))) {
    throw new ValidationError('Invalid inspection hints or quote binding', { status: 400, field: 'security' });
  }
  return Object.fromEntries(Object.entries({ enabled: options.enabled, profile: options.profile, mode: options.mode,
    tier: options.tier, max_input_bytes: options.maxInputBytes, deep_validation: options.deepValidation,
    sanitization: options.sanitization, supplied_filename: options.suppliedFilename, declared_mime: options.declaredMime,
    pricing_version: options.pricingVersion, max_charge_cents: options.maxChargeCents }).filter(([, v]) => v !== undefined));
}

const formats = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'mp4', 'mov', 'webm', 'matroska', 'mp3', 'wav', 'flac', 'ogg', 'aac', 'aiff', 'caf', 'zip', 'pdf', 'executable', 'svg', 'html', 'manifest']);
const aliases: Record<string, string> = { jpg: 'jpeg', wave: 'wav', m4a: 'mp4', mkv: 'matroska' };
function normalized(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = aliases[value.toLowerCase()] ?? value.toLowerCase();
  return formats.has(name) ? name : null;
}
/** Pure application policy. Run on your backend; never authorizes MediaRuntime processing. */
export function evaluateFileReport(input: unknown, policy: FileReportPolicy): FileReportDecision {
  const envelope = object(input);
  const r = object('report' in envelope ? envelope.report : input);
  const reasons: string[] = [];
  const reject = (reason: string) => { if (!reasons.includes(reason)) reasons.push(reason); };
  if (r.reportVersion !== '1' || object(r.profile).id !== 'file_inspection_v1' || object(r.profile).version !== '1') reject('unsupported_report_version');
  policy = policy || { allowedFormats: [] };
  const allowed = Array.isArray(policy.allowedFormats) ? policy.allowedFormats.map(normalized) : [];
  if (!allowed.length || allowed.some(f => f === null)) reject('invalid_format_policy');
  const file = object(r.file), checks = object(r.checks);
  if (!file.sha256 || !/^[a-f0-9]{64}$/.test(String(file.sha256))) reject('missing_identity');
  if (!allowed.includes(normalized(file.detectedFormat)) || normalized(file.detectedFormat) === null) reject('format_not_allowed');
  const complete = (check: unknown, result: string) => { const c = object(check); return c.status === 'completed' && c.complete === true && c.result === result; };
  if (file.ambiguous !== false || !complete(checks.identification, 'identified')) reject('ambiguous_or_missing_identification');
  if (object(checks.malware).result === 'detected') reject('threat_detected');
  if (policy.requireCompleteInspection !== false && (r.inspectionStatus !== 'complete' || checkNames.some(n => !(n in checks)) ||
      Object.values(checks).some(c => object(c).requested === true && (object(c).status !== 'completed' || object(c).complete !== true)))) reject('inspection_incomplete');
  const scanner = object(r.scanner);
  if (policy.requireMalwareScan !== false && (!complete(checks.malware, 'no_threat_detected') || object(checks.malware).coverage !== 'antivirus' ||
      !/^[a-f0-9]{64}$/.test(String(scanner.databaseSha256)) || !Number.isSafeInteger(scanner.databaseVersion) || Number(scanner.databaseVersion) < 1)) reject('malware_evidence_missing');
  if (policy.requireValidStructure !== false && !complete(checks.structure, 'valid')) reject('structure_not_valid');
  if (policy.requireDeepValidation && (!complete(checks.deep_validation, 'valid') || object(checks.deep_validation).coverage !== 'full_decode')) reject('deep_validation_missing');
  if (policy.maxScanAgeSeconds !== undefined && (!Number.isSafeInteger(policy.maxScanAgeSeconds) || policy.maxScanAgeSeconds < 1 ||
      typeof r.completedAt !== 'number' || !Number.isSafeInteger(r.completedAt) || r.completedAt < 1 ||
      r.completedAt > Date.now() / 1000 || Date.now() / 1000 - r.completedAt > policy.maxScanAgeSeconds)) reject('scan_age_exceeded');
  if (policy.requireSanitizedDerivative && (!complete(checks.sanitization, 'reencoded') || object(r.sanitization).reinspectionCompleted !== true || object(r.sanitization).sourceSha256 !== file.sha256 || !/^[a-f0-9]{64}$/.test(String(object(r.sanitization).sha256)))) reject('sanitized_derivative_missing');
  if (policy.archiveEntryFormats) {
    const entryFormats = Array.isArray(policy.archiveEntryFormats) ? policy.archiveEntryFormats.map(normalized) : [], archive = object(r.archive);
    if (!entryFormats.length || entryFormats.some(f => f === null)) reject('invalid_entry_policy');
    if (file.detectedFormat !== 'zip' || !complete(checks.archive, 'inspected') || archive.entriesComplete !== true || archive.entriesTruncated !== false ||
        !Array.isArray(archive.entries) || archive.entries.length !== archive.entriesTotal) reject('archive_entry_coverage_incomplete');
    for (const raw of Array.isArray(archive.entries) ? archive.entries : []) {
      const entry = object(raw), ec = object(entry.checks);
      if (!entryFormats.includes(normalized(entry.detectedFormat)) || normalized(entry.detectedFormat) === null) reject('archive_entry_format_not_allowed');
      if (entry.encrypted !== false || !complete(ec.identification, 'identified') || !complete(ec.structure, 'valid') || !complete(ec.malware, 'no_threat_detected') ||
          (policy.requireDeepValidation && !complete(ec.deep_validation, 'valid'))) reject('archive_entry_evidence_missing');
    }
  }
  if (r.findingsTruncated !== false || !Array.isArray(r.findings)) reject('findings_incomplete');
  if (Array.isArray(r.findings)) for (const finding of r.findings) {
    if (['threat_detected', 'unsafe_archive_path', 'archive_symlink', 'malformed_data', 'wav_riff_size_mismatch', 'wav_chunk_truncated', 'wav_required_chunk_missing', 'wav_format_invalid', 'wav_adpcm_block_invalid', 'id3_header_invalid', 'id3_tag_truncated', 'mp3_frame_header_invalid', 'mp3_frame_truncated', 'flac_streaminfo_invalid', 'flac_metadata_truncated', 'flac_streaminfo_missing', 'ogg_page_crc_mismatch', 'ogg_page_truncated', 'ogg_page_sequence_invalid', 'ogg_end_marker_missing', 'aac_frame_length_invalid', 'aac_frame_truncated', 'aac_frame_header_invalid', 'mp4_box_size_invalid', 'mp4_box_truncated', 'mp4_required_box_missing', 'png_chunk_crc_mismatch', 'jpeg_segment_length_invalid', 'jpeg_segment_truncated', 'jpeg_end_marker_missing', 'jpeg_frame_header_missing', 'png_chunk_truncated', 'png_ihdr_length_invalid', 'png_duplicate_chunk', 'png_chunk_order_invalid', 'png_required_chunk_missing', 'webp_riff_size_mismatch', 'webp_chunk_truncated', 'webp_chunk_padding_invalid', 'webp_extended_header_invalid', 'webp_image_data_missing', 'archive_crc_mismatch', 'archive_decompression_failed', 'archive_structure_invalid', 'ambiguous_type'].includes(String(object(finding).code))) reject(String(object(finding).code));
  }
  return { accepted: reasons.length === 0, reasons };
}
