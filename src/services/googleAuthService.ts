export interface GoogleTokenPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function verifyGoogleIdToken(idToken: string, client?: string): Promise<GoogleTokenPayload> {
  const clientId =
    client === 'web'
      ? process.env.GOOGLE_WEB_CLIENT_ID
      : process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      client === 'web' ? 'GOOGLE_WEB_CLIENT_ID not configured' : 'GOOGLE_CLIENT_ID not configured',
    );
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error('Invalid Google id_token');
  }

  const data = await res.json() as Record<string, string>;

  if (data.aud !== clientId) {
    throw new Error('Token audience mismatch');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(data.exp) <= now) {
    throw new Error('Token expired');
  }

  if (!data.sub || !data.email) {
    throw new Error('Missing required token claims');
  }

  return {
    sub: data.sub,
    email: data.email,
    name: data.name || data.email,
    picture: data.picture,
  };
}
