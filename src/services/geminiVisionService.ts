const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 60000;

export interface RecognizedIdData {
  id_number: string;
  full_name: string;
  date_of_birth: string;
  sex: string;
  nationality: string;
  home: string;
  address: string;
  issue_date: string;
  expiry_date: string;
}

export class NotIdCardError extends Error {
  constructor() {
    super('Image is not an identity card');
    this.name = 'NotIdCardError';
  }
}

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiConfigError';
  }
}

const PROMPT = [
  'You are extracting identity data from a photo of a Vietnamese ID card (CCCD).',
  'Return ONE JSON object with exactly these keys:',
  'full_name, id_number (digits only), date_of_birth ("YYYY-MM-DD"),',
  'sex ("M"|"F"|""), nationality, home (origin/permanent residence),',
  'address (current place of residence), issue_date ("YYYY-MM-DD"), expiry_date ("YYYY-MM-DD").',
  'Copy text EXACTLY as printed on the card; convert any printed date to YYYY-MM-DD.',
  'Extract ONLY text visibly printed on THIS image; never guess or fill values from memory.',
  'A card side shows only some of the fields - unreadable or absent field -> "".',
  'If the image is NOT an ID card, return {"error":"not_an_id_card"}.',
  'Return ONLY valid JSON, no markdown fences.',
].join('\n');

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDate(value: unknown): string {
  const s = asString(value);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = m[1]!.padStart(2, '0');
    const month = m[2]!.padStart(2, '0');
    return `${m[3]}-${month}-${day}`;
  }
  return '';
}

const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseIsoDate(dateString: string | undefined | null): Date | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

function sideHint(side: 'front' | 'back'): string {
  return side === 'back'
    ? 'This is the BACK side of the card. It typically shows only place-of-birth registration, distinguishing features, issue_date and expiry_date ("Không thời hạn" means no expiry -> expiry_date ""). Leave name/id/dob fields empty unless they are visibly printed on THIS image.'
    : 'This is the FRONT side of the card.';
}

async function requestRecognition(
  apiKey: string,
  model: string,
  imageBuffer: Buffer,
  side: 'front' | 'back',
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${PROMPT}\n${sideHint(side)}` },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `Gemini API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const payload = (await res.json().catch(() => null)) as GeminiResponse | null;
  const text =
    payload?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const jsonCandidate = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  try {
    return JSON.parse(jsonCandidate) as Record<string, unknown>;
  } catch {
    throw new Error(`Gemini returned non-JSON content: ${raw.slice(0, 200)}`);
  }
}

function mapRecognized(parsed: Record<string, unknown>): RecognizedIdData {
  return {
    id_number: asString(parsed.id_number).replace(/\D/g, ''),
    full_name: asString(parsed.full_name),
    date_of_birth: normalizeDate(parsed.date_of_birth),
    sex: asString(parsed.sex),
    nationality: asString(parsed.nationality),
    home: asString(parsed.home),
    address: asString(parsed.address),
    issue_date: normalizeDate(parsed.issue_date),
    expiry_date: normalizeDate(parsed.expiry_date),
  };
}

export async function recognizeIdCard(
  imageBuffer: Buffer,
  side: 'front' | 'back' = 'front',
): Promise<RecognizedIdData> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new GeminiConfigError('GOOGLE_AI_API_KEY is not configured');
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let lastError: Error;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const parsed = await requestRecognition(apiKey, model, imageBuffer, side);
      if (asString(parsed.error) === 'not_an_id_card') {
        throw new NotIdCardError();
      }
      return mapRecognized(parsed);
    } catch (err) {
      if (err instanceof NotIdCardError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError!;
}
