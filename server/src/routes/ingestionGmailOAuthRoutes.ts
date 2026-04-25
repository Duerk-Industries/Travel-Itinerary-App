import { Router } from 'express';
import { getBackendUrl } from '../env';
import { upsertProviderConnection } from '../ingestion/shared/repository';
import { decodeGmailOAuthState } from '../ingestion/gmail/oauth';
import { exchangeGmailCodeForTokens, fetchGmailProfile } from '../ingestion/intake/gmail';
import { logError } from '../logger';

const router = Router();

const buildRedirectUrl = (req: any, redirectUri: string | undefined, params: Record<string, string>): string => {
  const fallbackBase = getBackendUrl(`${req.protocol}://${req.get('host')}`)!;
  const url = new URL(redirectUri ?? '/app', fallbackBase);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

router.get('/callback', async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  const state = String(req.query.state ?? '').trim();
  const error = String(req.query.error ?? '').trim();
  const decoded = state ? decodeGmailOAuthState(state) : null;
  const redirectUri = decoded?.redirectUri;

  if (error) {
    res.redirect(buildRedirectUrl(req, redirectUri, { gmail_import_error: error }));
    return;
  }

  if (!code || !decoded?.userId) {
    res.redirect(buildRedirectUrl(req, redirectUri, { gmail_import_error: 'invalid_callback' }));
    return;
  }

  try {
    const exchanged = await exchangeGmailCodeForTokens({ code, request: req });
    const profile = await fetchGmailProfile(exchanged.accessToken);
    await upsertProviderConnection({
      userId: decoded.userId,
      provider: 'gmail',
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken ?? null,
      tokenExpiry: exchanged.tokenExpiry,
      scopes: exchanged.scope,
      metadata: {
        emailAddress: profile.emailAddress,
        messagesTotal: profile.messagesTotal ?? null,
        threadsTotal: profile.threadsTotal ?? null,
        scopeReviewAcceptedAt: new Date().toISOString(),
      },
    });
    res.redirect(buildRedirectUrl(req, redirectUri, { gmail_import: 'connected' }));
  } catch (callbackError) {
    logError('[ingestion] gmail callback failed', callbackError);
    res.redirect(buildRedirectUrl(req, redirectUri, { gmail_import_error: 'callback_failed' }));
  }
});

export default router;
