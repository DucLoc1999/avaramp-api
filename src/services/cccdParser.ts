import type { RecognizedIdData } from './geminiVisionService';
import { NotIdCardError } from './geminiVisionService';

export interface ParsedCccd {
  data: RecognizedIdData;
  side: 'front' | 'back';
  hasRequiredFields: boolean;
  hasAnySignal: boolean;
}

type FieldName =
  | 'id_number'
  | 'full_name'
  | 'date_of_birth'
  | 'sex'
  | 'nationality'
  | 'home'
  | 'address'
  | 'issue_date'
  | 'expiry_date';

interface LabelRule {
  field: FieldName;
  patterns: string[];
}

const LABELS: LabelRule[] = [
  {
    field: 'id_number',
    patterns: [
      'personal identification number',
      'so dinh danh',
      'identification number',
      'so /no',
      'so/no',
    ],
  },
  {
    field: 'full_name',
    patterns: ['full name', 'ho va ten khai sinh', 'ho va ten', 'ho ten', 'ten khai sinh'],
  },
  {
    field: 'date_of_birth',
    patterns: ['date of birth', 'ngay thang nam sinh', 'nam sinh', 'ngay sinh'],
  },
  { field: 'sex', patterns: ['gioi tinh', '/sex', ' sex '] },
  { field: 'nationality', patterns: ['nationality', 'quoc tich'] },
  {
    field: 'address',
    patterns: ['place of residence', 'noi cu tru', 'cho thuong tru', 'cu tru'],
  },
  {
    field: 'home',
    patterns: [
      'place of origin',
      'que quan',
      'noi dang ky khai sinh',
      'place of birth registration',
      'noi khai sinh',
    ],
  },
  {
    field: 'issue_date',
    patterns: ['date of issue', 'ngay thang nam cap', 'ngay cap', 'nam cap'],
  },
  {
    field: 'expiry_date',
    patterns: ['date of expiry', 'ngay het han', 'het han', 'co gia tri den', 'gia tri den', 'expiry'],
  },
];

export function stripDiacritics(input: string): string {
  return input
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function norm(input: string): string {
  return ` ${stripDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9/<>.:\- ]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

function loose(input: string): string {
  return stripDiacritics(input).toLowerCase();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED_LABELS: Array<{ rule: LabelRule; re: RegExp }> = (() => {
  const compiled: Array<{ rule: LabelRule; re: RegExp }> = [];
  for (const rule of LABELS) {
    for (const pattern of rule.patterns) {
      const body = pattern
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(escapeRegExp)
        .join('[^a-z0-9]+');
      compiled.push({
        rule,
        re: new RegExp(`(^|[^a-z0-9])${body}([^a-z0-9]|$)`, 'g'),
      });
    }
  }
  return compiled;
})();

interface LabelHit {
  rule: LabelRule;
  start: number;
  end: number;
}

function findNextLabel(text: string, from: number): LabelHit | null {
  let best: LabelHit | null = null;
  for (const { rule, re } of COMPILED_LABELS) {
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[1]!.length;
    const end = m.index + m[0]!.length - m[2]!.length;
    if (!best || start < best.start) {
      best = { rule, start, end };
    }
  }
  return best;
}

function findLabels(text: string): LabelHit[] {
  const hits: LabelHit[] = [];
  let current = findNextLabel(text, 0);
  let guard = 0;
  while (current && guard++ < 8) {
    hits.push(current);
    current = findNextLabel(
      text,
      Math.max(current.end, current.start + 1),
    );
  }
  return hits;
}

const ALL_PATTERN_STRINGS = LABELS.flatMap((rule) =>
  rule.patterns.map((p) => p.toLowerCase()),
);

function hasLabelSubstring(text: string): boolean {
  const looseText = stripDiacritics(text).toLowerCase();
  return ALL_PATTERN_STRINGS.some((p) => looseText.includes(p));
}

function extractDate(raw: string): string {
  const dmy = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const month = dmy[2]!.padStart(2, '0');
    return `${dmy[3]}-${month}-${day}`;
  }
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0]!;
  return '';
}

function isNoExpiry(raw: string): boolean {
  const n = norm(raw);
  return (
    n.includes('khong thoi han') ||
    n.includes('khong han') ||
    n.includes('no expiration') ||
    n.includes('does not expire')
  );
}

function extractSex(raw: string): string {
  const n = norm(raw);
  if (/\bnam\b/.test(n) && !/\bnu\b/.test(n)) return 'M';
  if (/\bnu\b|\bfemale\b/.test(n)) return 'F';
  if (/\bmale\b/.test(n)) return 'M';
  return '';
}

function extractIdNumber(raw: string): string {
  const m = raw.match(/\d{12}/) ?? raw.match(/\d{9}/);
  return m ? m[0]! : '';
}

function cleanTextValue(raw: string): string {
  return raw
    .replace(/<+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:.\-,]+|[\s:.\-]+$/g, '')
    .trim();
}

function plausibleName(raw: string): boolean {
  const v = cleanTextValue(raw);
  if (!v || /\d/.test(v)) return false;
  const words = v.split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 6;
}

function plausibleLongText(raw: string): boolean {
  const v = cleanTextValue(raw);
  return v.length >= 4 && /[a-zA-Z]/.test(v);
}

interface MrzData {
  id_number: string;
  date_of_birth: string;
  sex: string;
  expiry_date: string;
  full_name: string;
}

function mrzCentury(yy: string): string {
  return Number(yy) >= 40 ? '19' : '20';
}

function parseMrz(lines: string[]): MrzData | null {
  const candidates = lines.filter((l) => l.length >= 28 && /^[A-Z0-9<]+$/.test(l));
  if (candidates.length < 2) return null;

  const result: MrzData = {
    id_number: '',
    date_of_birth: '',
    sex: '',
    expiry_date: '',
    full_name: '',
  };

  for (let i = 0; i < candidates.length - 1; i++) {
    const l1 = candidates[i]!;
    const l2 = candidates[i + 1]!;
    if (!l1.startsWith('IDVNM')) continue;

    const printedId =
      l1.match(/(\d{12})(?=<{2})/)?.[1] ??
      (() => {
        const runs12 = [...l1.matchAll(/\d{12}/g)].map((m) => m[0]!);
        return runs12.length ? runs12[runs12.length - 1]! : '';
      })();
    if (printedId) result.id_number = printedId;

    const m = l2.match(/^(\d{6})(\d)([MF])(\d{6})/);
    if (m) {
      const dobYy = m[1]!.slice(0, 2)!;
      const dobMm = m[1]!.slice(2, 4)!;
      const dobDd = m[1]!.slice(4, 6)!;
      result.date_of_birth = `${mrzCentury(dobYy)}${dobYy}-${dobMm}-${dobDd}`;
      result.sex = m[3]!;
      const expYy = m[4]!.slice(0, 2)!;
      const expMm = m[4]!.slice(2, 4)!;
      const expDd = m[4]!.slice(4, 6)!;
      if (m[4] !== '991231') {
        result.expiry_date = `${mrzCentury(expYy)}${expYy}-${expMm}-${expDd}`;
      }
    }

    const nameLine = candidates.find(
      (c, idx) => idx > i + 1 && /^[A-Z<]+$/.test(c) && c.includes('<<'),
    );
    if (nameLine) {
      result.full_name = cleanTextValue(nameLine.replace(/</g, ' '));
    }
    return result;
  }
  return null;
}

const DEFAULT_NATIONALITY = 'Việt Nam';

const EMPTY_DATA: RecognizedIdData = {
  id_number: '',
  full_name: '',
  date_of_birth: '',
  sex: '',
  nationality: '',
  home: '',
  address: '',
  issue_date: '',
  expiry_date: '',
};

export function parseCccdText(text: string, side: 'front' | 'back'): ParsedCccd {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r/g, '').trim())
    .filter(Boolean);

  const captured = new Map<FieldName, string>();
  let expiryExplicitNone = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const hits = findLabels(loose(raw));
    if (!hits.length) continue;

    for (let s = hits.length - 1; s >= 0; s--) {
      const hit = hits[s]!;
      if (captured.has(hit.rule.field)) continue;

      const segEnd =
        s + 1 < hits.length ? hits[s + 1]!.start : raw.length;
      const segRaw = raw.slice(Math.min(hit.start, raw.length), segEnd);
      const colonIdx = segRaw.indexOf(':');
      let value = colonIdx >= 0 ? segRaw.slice(colonIdx + 1).trim() : '';

      const wantsContinuation =
        hit.rule.field === 'home' || hit.rule.field === 'address';
      const valueIsLabel = value
        ? findLabels(loose(value)).length > 0 || hasLabelSubstring(value)
        : false;
      if (!value || valueIsLabel || wantsContinuation) {
        const followUp: string[] = [];
        if (value && !valueIsLabel) followUp.push(value);
        for (let j = i + 1; j < lines.length; j++) {
          if (
            findLabels(loose(lines[j]!)).length ||
            hasLabelSubstring(lines[j]!)
          ) {
            break;
          }
          followUp.push(lines[j]!);
          if (followUp.length >= 2) break;
        }
        value = followUp.join(', ');
      }

      if (hit.rule.field === 'expiry_date' && isNoExpiry(value)) {
        expiryExplicitNone = true;
        captured.set('expiry_date', '');
        continue;
      }
      if (value.trim()) {
        captured.set(hit.rule.field, value.trim());
      }
    }
  }

  const data: RecognizedIdData = { ...EMPTY_DATA };

  const idValue = captured.get('id_number');
  data.id_number = idValue ? extractIdNumber(idValue) : '';
  const nameValue = captured.get('full_name');
  data.full_name = nameValue && plausibleName(nameValue) ? cleanTextValue(nameValue) : '';
  data.date_of_birth = extractDate(captured.get('date_of_birth') ?? '');
  data.sex = extractSex(captured.get('sex') ?? '');
  data.nationality =
    cleanTextValue(captured.get('nationality') ?? '') || DEFAULT_NATIONALITY;
  data.home = cleanTextValue(captured.get('home') ?? '');
  const addressValue = captured.get('address');
  data.address = addressValue && plausibleLongText(addressValue) ? cleanTextValue(addressValue) : '';
  data.issue_date = extractDate(captured.get('issue_date') ?? '');

  if (expiryExplicitNone) {
    data.expiry_date = '';
  } else {
    const expiryValue = captured.get('expiry_date');
    if (expiryValue && isNoExpiry(expiryValue)) {
      data.expiry_date = '';
    } else {
      data.expiry_date = extractDate(expiryValue ?? '');
    }
  }

  const mrz = parseMrz(lines);
  if (mrz) {
    if (!data.id_number && mrz.id_number) data.id_number = mrz.id_number;
    if (!data.full_name && mrz.full_name && plausibleName(mrz.full_name)) {
      data.full_name = mrz.full_name;
    }
    if (!data.date_of_birth && mrz.date_of_birth) data.date_of_birth = mrz.date_of_birth;
    if (!data.sex && mrz.sex) data.sex = mrz.sex;
    if (!data.expiry_date && !expiryExplicitNone && mrz.expiry_date) {
      data.expiry_date = mrz.expiry_date;
    }
  }

  const hasAnySignal =
    captured.size > 0 || Boolean(mrz) || /\b\d{9}\b|\b\d{12}\b/.test(text);

  if (!hasAnySignal) {
    throw new NotIdCardError();
  }

  const hasRequiredFields =
    side === 'front'
      ? Boolean(
          data.id_number && data.full_name && data.date_of_birth && data.sex,
        )
      : true;

  return { data, side, hasRequiredFields, hasAnySignal };
}
