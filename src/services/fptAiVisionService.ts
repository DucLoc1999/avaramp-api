/**
 * @deprecated LEGACY SOLUTION — superseded by `geminiVisionService`.
 * Kept for reference/rollback only. Do NOT call from active code paths.
 */
import axios from 'axios';
import FormData from 'form-data';

export interface FptAiVisionIdData {
  id: string;
  name: string;
  dob: string;
  sex: string;
  nationality: string;
  home: string;
  address: string;
  doe: string;
  type?: string;
  features?: string;
  issue_date?: string;
  issue_loc?: string;
  overall_score?: number;
}

interface FptAiVisionResponse {
  data: FptAiVisionIdData[];
  errorCode: string;
  errorMessage: string;
}

const baseApiUrl = process.env.FPT_API_SERVICE_URL || '';
const apiKey = process.env.FPT_API_SERVICE_KEY || '';

export async function recognizeIdCard(imageBuffer: Buffer, filename: string = 'image.jpg'): Promise<FptAiVisionIdData> {
  const apiUrl = `${baseApiUrl}/idr/vnm`;

  const formData = new FormData();
  formData.append('image', imageBuffer, { filename });

  const response = await axios.post<FptAiVisionResponse>(apiUrl, formData, {
    headers: {
      ...formData.getHeaders(),
      'api-key': apiKey,
    },
    timeout: 30000,
  });

  if (response.data.errorCode && response.data.errorCode !== '0') {
    throw new Error(`FPT AI Vision API error: ${response.data.errorMessage || 'Unknown error'}`);
  }

  if (!response.data.data || response.data.data.length === 0) {
    throw new Error('No ID card data found in the image');
  }

  const idData = response.data.data[0];
  if (!idData) {
    throw new Error('No ID card data found in the response');
  }

  return idData;
}

export function parseDate(dateString: string | undefined): Date | null {
  if (!dateString) return null;

  const parts = dateString.split('/');
  if (parts.length !== 3) return null;

  const [dayStr, monthStr, yearStr] = parts;
  if (!dayStr || !monthStr || !yearStr) return null;

  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;

  return date;
}
