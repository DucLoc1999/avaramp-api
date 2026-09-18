import * as geminiVisionService from './geminiVisionService';
import { isOcrSpaceConfigured, ocrImage } from './ocrSpaceService';
import { parseCccdText } from './cccdParser';

export type { RecognizedIdData } from './geminiVisionService';
export {
  NotIdCardError,
  GeminiConfigError,
  parseIsoDate,
} from './geminiVisionService';

export type RecognitionProvider = 'ocrspace' | 'gemini';

export interface RecognitionResult {
  data: geminiVisionService.RecognizedIdData;
  provider: RecognitionProvider;
}

type ProviderMode = 'hybrid' | 'ocrspace' | 'gemini';

function resolveMode(): ProviderMode {
  const raw = (process.env.ID_RECOGNITION_PROVIDER || 'hybrid').toLowerCase();
  if (raw === 'ocrspace' || raw === 'gemini') return raw;
  return 'hybrid';
}

async function recognizeViaOcrSpace(
  imageBuffer: Buffer,
  side: 'front' | 'back',
): Promise<RecognitionResult> {
  const ocr = await ocrImage(imageBuffer);
  const parsed = parseCccdText(ocr.text, side);
  if (!parsed.hasRequiredFields) {
    throw new Error(
      `OCR.space text missing required ${side} fields (labels=${[...Object.entries(parsed.data)]
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(',') || 'none'})`,
    );
  }
  return { data: parsed.data, provider: 'ocrspace' };
}

export async function recognizeWithProvider(
  imageBuffer: Buffer,
  side: 'front' | 'back',
): Promise<RecognitionResult> {
  const mode = resolveMode();

  if (mode === 'gemini') {
    return {
      data: await geminiVisionService.recognizeIdCard(imageBuffer, side),
      provider: 'gemini',
    };
  }

  if (!isOcrSpaceConfigured()) {
    if (mode === 'ocrspace') {
      throw new Error('OCR_SPACE_API_KEY is not configured');
    }
    return {
      data: await geminiVisionService.recognizeIdCard(imageBuffer, side),
      provider: 'gemini',
    };
  }

  try {
    return await recognizeViaOcrSpace(imageBuffer, side);
  } catch (fastPathErr) {
    if (fastPathErr instanceof geminiVisionService.NotIdCardError) {
      throw fastPathErr;
    }
    const reason =
      fastPathErr instanceof Error ? fastPathErr.message : String(fastPathErr);
    console.warn(
      `[id-recognition] OCR.space fast path failed (${side}): ${reason} — falling back to Gemini`,
    );
  }

  return {
    data: await geminiVisionService.recognizeIdCard(imageBuffer, side),
    provider: 'gemini',
  };
}

export async function recognizeIdCard(
  imageBuffer: Buffer,
  side: 'front' | 'back' = 'front',
): Promise<geminiVisionService.RecognizedIdData> {
  const { data } = await recognizeWithProvider(imageBuffer, side);
  return data;
}
