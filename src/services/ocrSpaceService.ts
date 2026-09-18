const DEFAULT_ENDPOINT = 'https://api.ocr.space/parse/image';
const DEFAULT_ENGINE = 2;
const DEFAULT_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 1500;

export interface OcrSpaceResult {
  text: string;
  processingMs: number;
}

export class OcrSpaceError extends Error {
  readonly retriable: boolean;

  constructor(message: string, retriable = false) {
    super(message);
    this.name = 'OcrSpaceError';
    this.retriable = retriable;
  }
}

export function isOcrSpaceConfigured(): boolean {
  return Boolean(process.env.OCR_SPACE_API_KEY);
}

interface OcrSpaceResponse {
  ParsedResults?: Array<{
    ParsedText?: string;
    FileParseExitCode?: number | string;
    ErrorMessage?: string;
  }>;
  OCRExitCode?: number | string;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[] | null;
}

function errorMessage(value: unknown): string {
  if (Array.isArray(value)) return value.join('; ');
  return typeof value === 'string' ? value : '';
}

async function requestOcr(
  apiKey: string,
  endpoint: string,
  engine: number,
  timeoutMs: number,
  imageBuffer: Buffer,
): Promise<OcrSpaceResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }),
    'image.jpg',
  );
  form.append('language', 'vnm');
  form.append('scale', 'true');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', String(engine));

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OcrSpaceError(`OCR.space request failed: ${msg}`, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const retriable = res.status >= 500 || res.status === 429;
    throw new OcrSpaceError(
      `OCR.space error ${res.status}: ${body.slice(0, 300)}`,
      retriable,
    );
  }

  const payload = (await res.json().catch(() => null)) as OcrSpaceResponse | null;
  if (!payload) {
    throw new OcrSpaceError('OCR.space returned invalid JSON');
  }
  if (payload.IsErroredOnProcessing) {
    throw new OcrSpaceError(
      `OCR.space processing error: ${errorMessage(payload.ErrorMessage) || 'unknown'}`,
    );
  }

  const exitCode = Number(payload.OCRExitCode ?? 0);
  if (exitCode === 4) {
    throw new OcrSpaceError(
      `OCR.space fatal parse error: ${errorMessage(payload.ErrorMessage)}`,
    );
  }

  const text = (payload.ParsedResults ?? [])
    .filter((p) => Number(p.FileParseExitCode) === 1)
    .map((p) => (p.ParsedText ?? '').trim())
    .filter(Boolean)
    .join('\n');

  if (!text) {
    const detail = (payload.ParsedResults ?? [])
      .map((p) => p.ErrorMessage)
      .filter(Boolean)
      .join('; ');
    throw new OcrSpaceError(
      `OCR.space returned no text${detail ? `: ${detail}` : ''}`,
      true,
    );
  }

  return { text, processingMs: Date.now() - startedAt };
}

export async function ocrImage(
  imageBuffer: Buffer,
): Promise<OcrSpaceResult> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new OcrSpaceError('OCR_SPACE_API_KEY is not configured');
  }
  const endpoint = process.env.OCR_SPACE_ENDPOINT || DEFAULT_ENDPOINT;
  const engine = Number(process.env.OCR_SPACE_ENGINE || DEFAULT_ENGINE);
  const timeoutMs = Number(
    process.env.OCR_SPACE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    try {
      return await requestOcr(apiKey, endpoint, engine, timeoutMs, imageBuffer);
    } catch (err) {
      lastError = err;
      if (!(err instanceof OcrSpaceError) || !err.retriable) throw err;
    }
  }
  throw lastError;
}
