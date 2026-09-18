/**
 * SePay Payment Gateway NAPAS checkout.
 *
 * Creates a NAPAS bank-transfer checkout order on SePay's payment gateway by
 * emulating the browser checkout flow:
 *
 *   Step 1 — POST /v1/checkout/init   (HMAC-signed init) → 302 + `ap_s` cookie
 *   Step 2 — GET  selection page      → extract NAPAS hidden form
 *   Step 3 — POST /v1/checkout/init   (NAPAS form fields) → 302 → QR page
 *   Step 4 — GET  QR page             → parse VietQR URL + bank details
 *
 * Requires SEPAY_MERCHANT_ID and SEPAY_SECRET_KEY env vars.
 */
import crypto from 'crypto';
import { getConfig } from './configService';

const SEPAY_CHECKOUT_URL = 'https://pay.sepay.vn/v1/checkout';
const SEPAY_INIT_URL = `${SEPAY_CHECKOUT_URL}/init`;
const SEPAY_PGAPI_URL = 'https://pgapi.sepay.vn';

const SIGNED_FIELDS = [
  'order_amount', 'merchant', 'currency', 'operation',
  'order_description', 'order_invoice_number',
  'success_url', 'error_url', 'cancel_url',
];

export interface NapasCheckoutResult {
  bank_info: {
    account_number: string;
    account_holder_name: string;
    bank_name: string;
    bank_short_name: string;
  };
  qr_code_url: string;
  va_number: string;
  transfer_content: string;
  amount: number;
  trace_id: string;
}

interface SepayOrderInfo {
  orderId: string;
  traceId: string;
  invoiceNumber: string;
  description: string;
  amount: number;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  transferContent: string;
  qrCodeUrl: string;
}

function merchantConfig(): { merchantId: string; secretKey: string } {
  const merchantId = process.env.SEPAY_MERCHANT_ID || '';
  const secretKey = process.env.SEPAY_SECRET_KEY || '';
  if (!merchantId || !secretKey) {
    throw new Error('MISSING_SEPAY_MERCHANT_CONFIG');
  }
  return { merchantId, secretKey };
}

function signFields(fields: Record<string, string>, secretKey: string): string {
  const sigString = SIGNED_FIELDS
    .filter((f) => fields[f])
    .map((f) => `${f}=${fields[f]}`)
    .join(',');
  return crypto.createHmac('sha256', secretKey).update(sigString).digest('base64');
}

function extract(html: string, pattern: RegExp): string | null {
  return html.match(pattern)?.[1] ?? null;
}

function decodeHex(s: string): string {
  return s.replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function mergeCookies(existing: string, newSetCookie: string[]): string {
  if (!newSetCookie.length) return existing;
  const map = new Map<string, string>();
  for (const c of existing.split('; ').filter(Boolean)) {
    const [k, ...v] = c.split('=');
    map.set(k, v.join('='));
  }
  for (const c of newSetCookie) {
    const [kv] = c.split(';');
    const [k, ...v] = kv.split('=');
    map.set(k, v.join('='));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function postForm(
  url: string,
  bodyStr: string,
  cookie: string,
): Promise<{ status: number; redirectUrl: string; cookie: string; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: bodyStr,
    redirect: 'manual',
  });
  const setCookies = res.headers.getSetCookie?.() || [];
  return {
    status: res.status,
    redirectUrl: res.headers.get('location') || '',
    cookie: mergeCookies(cookie, setCookies),
    body: await res.text(),
  };
}

async function getPage(url: string, cookie: string): Promise<{ html: string; cookie: string }> {
  const res = await fetch(url, { method: 'GET', headers: { Cookie: cookie } });
  const setCookies = res.headers.getSetCookie?.() || [];
  return { html: await res.text(), cookie: mergeCookies(cookie, setCookies) };
}

function parseQrPage(html: string): SepayOrderInfo {
  const qrCodeUrl = extract(html, /<img[^>]+src="(https:\/\/vietqr\.app\/img[^"]+)"/) || '';
  const bankName = extract(html, /<span>(Ngân hàng[^<]+)<\/span>/) || '';
  const bankCode = extract(qrCodeUrl, /bank=(\d+)/) || '';
  const accountNumber = extract(html, /<span class="account-number">([^<]+)<\/span>/) || '';

  const allCopyBtns = [...html.matchAll(/copyToClipboard\('([^']+)'/g)].map((m) => m[1]);
  const transferContent = allCopyBtns.length > 1 ? allCopyBtns[1] : '';

  const amount = Number(extract(html, /<dd[^>]*>([0-9,]+)\s*VND<\/dd>/)?.replace(/,/g, '') || '0');
  const invoiceNumber = extract(html, /<dd class="mb-0 fw-bold">([^<]+)<\/dd>/) || '';
  const description = extract(html, /<dd class="mb-0 text-muted fw-bold">([^<]+)<\/dd>/) || '';

  const orderId = extract(html, /order_id=([A-Z0-9]+)/) || '';
  const traceId = decodeHex(extract(html, /trace_id=([^&"]+)/) || '');

  return {
    orderId, traceId, invoiceNumber, description, amount,
    bankName, bankCode, accountNumber, transferContent, qrCodeUrl,
  };
}

function parseNapasForm(html: string): Record<string, string> {
  const form = html.match(/id="form-napasBankTransferOnetimeCheckout"[\s\S]*?<\/form>/)?.[0];
  if (!form) throw new Error('NAPAS_FORM_NOT_FOUND');

  const allSigs = [...form.matchAll(/name="signature"\s+value="([^"]+)"/g)].map((m) => m[1]);
  const signature = allSigs.length > 1 ? allSigs[allSigs.length - 1] : allSigs[0] || '';

  const get = (name: string) => {
    const val = extract(form, new RegExp(`name="${name}"\\s+value="([^"]+)"`));
    return val ? decodeHtmlEntities(val) : '';
  };

  return {
    order_amount: get('order_amount'),
    merchant: get('merchant'),
    currency: get('currency'),
    operation: get('operation'),
    order_description: get('order_description'),
    order_invoice_number: get('order_invoice_number'),
    success_url: get('success_url'),
    error_url: get('error_url'),
    cancel_url: get('cancel_url'),
    choose_payment_method: get('choose_payment_method'),
    payment_method: get('payment_method'),
    signature,
  };
}

function buildInitBody(fields: Record<string, string>, signature: string): string {
  const body = new URLSearchParams();
  body.set('order_amount', fields.order_amount);
  body.set('merchant', fields.merchant);
  body.set('currency', fields.currency);
  body.set('operation', fields.operation);
  body.set('order_description', fields.order_description);
  body.set('order_invoice_number', fields.order_invoice_number);
  body.set('success_url', fields.success_url);
  body.set('error_url', fields.error_url);
  body.set('cancel_url', fields.cancel_url);
  body.set('signature', signature);
  return body.toString();
}

/**
 * Create a SePay NAPAS bank-transfer checkout order.
 *
 * @param params - amount in VND, order description, and the invoice number
 *                 (MUST be the order's payment_code so the sepay-ipn webhook
 *                 can match it back to the order).
 */
export async function createNapasCheckout(params: {
  amount: number;
  description: string;
  invoice: string;
}): Promise<NapasCheckoutResult> {
  const { merchantId, secretKey } = merchantConfig();
  const amount = String(params.amount);
  const rawDomain = (process.env.DOMAIN || '').trim();
  if (!rawDomain) throw new Error('MISSING_DOMAIN_CONFIG');
  const baseUrl = (rawDomain.startsWith('http://') || rawDomain.startsWith('https://') ? rawDomain : `https://${rawDomain}`).replace(/\/$/, '');

  const redirect = (path: string) => `${baseUrl}/api/orders/${params.invoice}/${path}?amount=${amount}&invoice=${params.invoice}`;

  const fields = {
    order_amount: amount,
    merchant: merchantId,
    currency: 'VND',
    operation: 'PURCHASE',
    order_description: params.description,
    order_invoice_number: params.invoice,
    success_url: redirect('success'),
    error_url: redirect('error'),
    cancel_url: redirect('cancel'),
  };
  const signature = signFields(fields, secretKey);
  let cookie = '';

  const r1 = await postForm(SEPAY_INIT_URL, buildInitBody(fields, signature), cookie);
  cookie = r1.cookie;
  if (r1.status !== 302) throw new Error(`SEPAY_NAPAS_INIT_FAILED: ${r1.status}`);

  const r2 = await getPage(r1.redirectUrl, cookie);
  cookie = r2.cookie || cookie;
  if (!r2.html.includes('form-napasBankTransferOnetimeCheckout')) {
    throw new Error('NAPAS_FORM_NOT_FOUND');
  }

  const napasFields = parseNapasForm(r2.html);
  const r3 = await postForm(SEPAY_INIT_URL, new URLSearchParams(napasFields).toString(), cookie);
  cookie = r3.cookie || cookie;
  if (r3.status !== 302) {
    throw new Error(`SEPAY_NPAS_SUBMIT_FAILED: ${r3.status} — ${r3.body.slice(0, 200)}`);
  }

  const r4 = await getPage(r3.redirectUrl, cookie);
  const info = parseQrPage(r4.html);

  const accountHolder = await getConfig('bank_va_holder') || '';

  return {
    bank_info: {
      account_number: info.accountNumber,
      account_holder_name: accountHolder,
      bank_name: info.bankName,
      bank_short_name: info.bankCode,
    },
    qr_code_url: info.qrCodeUrl,
    va_number: info.accountNumber,
    transfer_content: info.transferContent,
    amount: info.amount,
    trace_id: info.traceId,
  };
}

/** Cancel a pending NAPAS order via the SePay pgapi. */
export async function cancelOrder(invoiceNumber: string): Promise<unknown> {
  const { merchantId, secretKey } = merchantConfig();
  const auth = Buffer.from(`${merchantId}:${secretKey}`).toString('base64');

  const res = await fetch(`${SEPAY_PGAPI_URL}/v1/order/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_invoice_number: invoiceNumber }),
  });
  return res.json();
}
