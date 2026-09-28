// Маленькая серверная функция для отправки настоящих push-уведомлений через
// Firebase Cloud Messaging (HTTP v1 API). Работает бесплатно на Netlify Functions,
// без Firebase Cloud Functions и без банковской карты.
//
// Секретный ключ сервисного аккаунта НЕ хранится в коде — он берётся из
// переменных окружения Netlify (Site settings → Environment variables):
//   FCM_PROJECT_ID     — id проекта Firebase (slchat-e30c5)
//   FCM_CLIENT_EMAIL    — email сервисного аккаунта (из скачанного JSON-ключа)
//   FCM_PRIVATE_KEY     — приватный ключ сервисного аккаунта (из того же JSON)
//
// Используются только встроенные возможности Node.js (crypto, fetch) —
// никаких npm-пакетов ставить не нужно.

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJwt(clientEmail, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return unsigned + '.' + signature;
}

async function getAccessToken(clientEmail, privateKey) {
  const jwt = createJwt(clientEmail, privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(jwt)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Не удалось получить access token: ' + JSON.stringify(data));
  return data.access_token;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid json' }) };
  }

  const { tokens, title, body, chatId } = payload;
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'no tokens' }) };
  }

  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'server not configured (missing env vars)' }) };
  }

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const results = [];
    // максимум 20 получателей за раз — этого более чем достаточно для личных
    // чатов и небольших групп
    for (const token of tokens.slice(0, 20)) {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                token,
                // Поле "notification" нужно, чтобы Android сама показала
                // всплывающее системное уведомление, даже когда приложение
                // полностью закрыто (без него на телефоне пуш до
                // закрытого/убитого приложения не доходит визуально) —
                // а "data" параллельно нужен для перехода в нужный чат по клику
                notification: {
                  title: String(title || 'SLchat').slice(0, 200),
                  body: String(body || '').slice(0, 500)
                },
                data: {
                  title: String(title || 'SLchat').slice(0, 200),
                  body: String(body || '').slice(0, 500),
                  chatId: String(chatId || ''),
                  icon: '/icon.png'
                },
                android: {
                  priority: 'high',
                  notification: {
                    sound: 'default'
                  }
                },
                webpush: {
                  headers: { Urgency: 'high' }
                }
              }
            })
          }
        );
        const data = await res.json();
        results.push({ ok: res.ok, data });
      } catch (e) {
        results.push({ ok: false, error: String(e) });
      }
    }
    return { statusCode: 200, body: JSON.stringify({ results }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
