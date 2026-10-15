// Серверная функция для push-уведомлений через Firebase Cloud Messaging (HTTP v1).
// Работает на Vercel (через api/send-push.js) и на Netlify.
//
// БЕЗОПАСНОСТЬ: функцию может вызвать только вошедший пользователь SLchat.
//  - в заголовке Authorization: Bearer <ID-токен Firebase> — проверяем, кто это;
//  - отправитель должен состоять в чате chatId;
//  - получателей и их адреса для push (fcmTokens) сервер берёт из базы САМ,
//    а заголовок уведомления — это настоящий ник отправителя.
// Так через функцию нельзя разослать поддельные уведомления кому угодно.
//
// Секретный ключ сервисного аккаунта НЕ хранится в коде — он берётся из
// переменных окружения хостинга:
//   FCM_PROJECT_ID     — id проекта Firebase (slchat-e30c5)
//   FCM_CLIENT_EMAIL    — email сервисного аккаунта
//   FCM_PRIVATE_KEY     — приватный ключ сервисного аккаунта
// Необязательные: FIREBASE_API_KEY (публичный ключ сайта), FIREBASE_DB_URL.

const crypto = require('crypto');

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCYpGauxKHayxESe1FfLcaK8tLHuun0Cok';
const DB_URL = (process.env.FIREBASE_DB_URL || 'https://slchat-e30c5-default-rtdb.firebaseio.com').replace(/\/$/, '');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(clientEmail, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    // Доступ к push-уведомлениям и к чтению базы (чтобы самим найти получателей)
    scope: [
      'https://www.googleapis.com/auth/firebase.messaging',
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return unsigned + '.' + signature;
}

async function getAccessToken(clientEmail, privateKey) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(createJwt(clientEmail, privateKey))
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Не удалось получить access token');
  return data.access_token;
}

// Кто вызывает функцию: проверяем ID-токен Firebase через официальный API Google
async function verifyCaller(idToken) {
  if (!idToken) return null;
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.users && data.users[0] && data.users[0].localId) || null;
}

async function dbGet(path, accessToken) {
  const res = await fetch(DB_URL + '/' + path + '.json?access_token=' + encodeURIComponent(accessToken));
  if (!res.ok) return null;
  return res.json();
}

function json(statusCode, obj) {
  return { statusCode, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'invalid json' }); }

  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return json(500, { error: 'server not configured (missing env vars)' });

  try {
    const senderUid = await verifyCaller(idToken);
    if (!senderUid) return json(401, { error: 'not signed in' });

    const chatId = String(payload.chatId || '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(chatId)) return json(400, { error: 'bad chatId' });

    const accessToken = await getAccessToken(clientEmail, privateKey);
    const meta = await dbGet('chats/' + chatId + '/meta', accessToken);
    const members = (meta && meta.members) || {};
    if (!members[senderUid]) return json(403, { error: 'not a member of this chat' });
    const banned = await dbGet('banned/' + senderUid, accessToken);
    if (banned) return json(403, { error: 'banned' });

    const mentions = (payload.mentions && typeof payload.mentions === 'object') ? payload.mentions : {};
    const now = Date.now();
    const sender = (await dbGet('users/' + senderUid, accessToken)) || {};
    const title = meta.type === 'group'
      ? String(sender.username || 'SLchat') + ' · ' + String(meta.name || 'Группа')
      : String(sender.username || 'SLchat');
    const body = String(payload.body || '').slice(0, 200);

    // Получатели: все участники чата, кроме отправителя; тем, кто заглушил чат,
    // не шлём — кроме упомянутых через @
    const tokens = [];
    for (const uid of Object.keys(members).slice(0, 200)) {
      if (uid === senderUid) continue;
      const u = (await dbGet('users/' + uid, accessToken)) || {};
      const mutedUntil = (u.muted && u.muted[chatId]) || 0;
      if (mutedUntil > now && !mentions[uid]) continue;
      Object.keys(u.fcmTokens || {}).forEach(t => tokens.push(t));
    }
    if (!tokens.length) return json(200, { results: [] });

    const results = [];
    for (const token of tokens.slice(0, 50)) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              // notification — чтобы Android сам показал уведомление при закрытом приложении,
              // data — чтобы по клику открыть нужный чат
              notification: { title: title.slice(0, 120), body },
              data: { title: title.slice(0, 120), body, chatId, icon: '/icon.png' },
              android: { priority: 'high', notification: { sound: 'default' } },
              webpush: { headers: { Urgency: 'high' } }
            }
          })
        });
        results.push({ ok: res.ok });
      } catch (e) {
        results.push({ ok: false });
      }
    }
    return json(200, { results });
  } catch (e) {
    return json(500, { error: 'push failed' });
  }
};
