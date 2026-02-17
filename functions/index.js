const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');

const NGROK_BASE_URL = defineSecret('NGROK_BASE_URL');
const NGROK_BASIC_AUTH = defineSecret('NGROK_BASIC_AUTH');
const STUDY_USERNAME = defineSecret('STUDY_USERNAME');
const STUDY_PASSWORD = defineSecret('STUDY_PASSWORD');
const SESSION_SECRET = defineSecret('SESSION_SECRET');

const SESSION_COOKIE_NAME = 'study_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function safeEqual(a, b) {
  const aa = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (aa.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey || rest.length === 0) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function makeSignature(username, expiresAt, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${username}.${expiresAt}`)
    .digest('base64url');
}

function makeSessionToken(username, secret) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const signature = makeSignature(username, expiresAt, secret);
  const payload = `${username}.${expiresAt}.${signature}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function parseSessionToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [username, expiresAtRaw, signature] = raw.split('.');
    const expiresAt = Number(expiresAtRaw);
    if (!username || !Number.isFinite(expiresAt) || !signature) {
      return null;
    }
    return { username, expiresAt, signature };
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function getJsonBody(req) {
  if (!req.rawBody) {
    return {};
  }

  try {
    return JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return {};
  }
}

function getUpstreamUrl(req, baseUrl) {
  const incoming = new URL(req.originalUrl || req.url, 'https://localhost');
  const upstreamPath = incoming.pathname.replace(/^\/api/, '') || '/';
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}${upstreamPath}${incoming.search}`;
}

function validateSession(req, sessionSecret) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token);
  if (!payload) {
    return null;
  }

  if (Date.now() > payload.expiresAt) {
    return null;
  }

  const expected = makeSignature(payload.username, payload.expiresAt, sessionSecret);
  if (!safeEqual(payload.signature, expected)) {
    return null;
  }

  return { username: payload.username, expiresAt: payload.expiresAt };
}

exports.apiProxy = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [
      NGROK_BASE_URL,
      NGROK_BASIC_AUTH,
      STUDY_USERNAME,
      STUDY_PASSWORD,
      SESSION_SECRET,
    ],
  },
  async (req, res) => {
    try {
      const sessionSecret = SESSION_SECRET.value();
      const studyUsername = STUDY_USERNAME.value();
      const studyPassword = STUDY_PASSWORD.value();
      const baseUrl = NGROK_BASE_URL.value();
      const ngrokBasicAuth = NGROK_BASIC_AUTH.value();

      if (
        !sessionSecret ||
        !studyUsername ||
        !studyPassword ||
        !baseUrl ||
        !ngrokBasicAuth
      ) {
        res.status(500).json({ error: 'Missing required function secrets.' });
        return;
      }

      if (req.path === '/auth/session' && req.method === 'GET') {
        const session = validateSession(req, sessionSecret);
        if (!session) {
          res.status(401).json({ authenticated: false });
          return;
        }

        res.status(200).json({ authenticated: true, username: session.username });
        return;
      }

      if (req.path === '/auth/login' && req.method === 'POST') {
        const body = getJsonBody(req);
        const username = body.username || '';
        const password = body.password || '';
        if (!safeEqual(username, studyUsername) || !safeEqual(password, studyPassword)) {
          res.status(401).json({ error: 'Invalid credentials' });
          return;
        }

        const token = makeSessionToken(username, sessionSecret);
        setSessionCookie(res, token);
        res.status(200).json({ authenticated: true });
        return;
      }

      if (req.path === '/auth/logout' && req.method === 'POST') {
        clearSessionCookie(res);
        res.status(200).json({ authenticated: false });
        return;
      }

      if (!req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const session = validateSession(req, sessionSecret);
      if (!session) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const upstreamUrl = getUpstreamUrl(req, baseUrl);
      logger.info(`proxy user=${session.username} ${req.method} ${req.path} -> ${upstreamUrl}`);

      const outgoingHeaders = new Headers();
      const passThroughHeaders = [
        'accept',
        'content-type',
        'range',
        'if-none-match',
        'if-modified-since',
        'cache-control',
      ];

      for (const headerName of passThroughHeaders) {
        const value = req.headers[headerName];
        if (typeof value === 'string' && value.length > 0) {
          outgoingHeaders.set(headerName, value);
        }
      }

      outgoingHeaders.set(
        'authorization',
        `Basic ${Buffer.from(ngrokBasicAuth, 'utf8').toString('base64')}`
      );

      const isBodyMethod = !['GET', 'HEAD'].includes(req.method);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let upstreamResponse;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: req.method,
          headers: outgoingHeaders,
          body: isBodyMethod ? req.rawBody : undefined,
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      logger.info(`upstream status ${upstreamResponse.status} for ${req.method} ${req.path}`);

      const responseHeadersToCopy = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
        'cache-control',
      ];

      for (const headerName of responseHeadersToCopy) {
        const value = upstreamResponse.headers.get(headerName);
        if (value) {
          res.setHeader(headerName, value);
        }
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      res.status(upstreamResponse.status).send(responseBody);
    } catch (error) {
      logger.error('apiProxy request failed', error);
      if (error && error.name === 'AbortError') {
        res.status(504).json({ error: 'Upstream timeout' });
        return;
      }
      res.status(502).json({ error: 'Upstream request failed' });
    }
  }
);
