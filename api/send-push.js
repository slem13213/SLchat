// Та же функция push-уведомлений, что и на Netlify, но для хостинга Vercel.
// Вся логика живёт в netlify/functions/send-push.js — здесь только «переходник»
// с формата Vercel (req, res) на формат Netlify (event -> { statusCode, body }).
// Ключи берутся из переменных окружения Vercel: FCM_PROJECT_ID,
// FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (Project → Settings → Environment Variables).

const { handler } = require('../netlify/functions/send-push.js');

module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const result = await handler({ httpMethod: req.method, body });
  res.setHeader('Content-Type', 'application/json');
  res.status(result.statusCode).send(result.body);
};
