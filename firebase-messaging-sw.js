// Service worker для push-уведомлений в браузере (Firebase Cloud Messaging).
// Показывает уведомление о новом сообщении, даже когда вкладка SLchat закрыта,
// а по клику открывает сайт сразу в нужном чате.
importScripts('https://cdn.jsdelivr.net/npm/firebase@10.13.0/firebase-app-compat.js');
importScripts('https://cdn.jsdelivr.net/npm/firebase@10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCYpGauxKHayxESe1FfLcaK8tLHuun0Cok',
  authDomain: 'slchat-e30c5.firebaseapp.com',
  projectId: 'slchat-e30c5',
  storageBucket: 'slchat-e30c5.firebasestorage.app',
  messagingSenderId: '589475343089',
  appId: '1:589475343089:web:08b2653fd4a596d4285750'
});

const messaging = firebase.messaging();

// Если в сообщении есть блок notification, браузер сам покажет уведомление —
// тогда второй раз не показываем. Иначе показываем вручную из data.
messaging.onBackgroundMessage(payload => {
  if(payload.notification) return;
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'SLchat', {
    body: d.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: d.chatId ? 'chat-' + d.chatId : undefined,
    data: { chatId: d.chatId || '' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const n = event.notification;
  const chatId = (n.data && (n.data.chatId || (n.data.FCM_MSG && n.data.FCM_MSG.data && n.data.FCM_MSG.data.chatId))) || '';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all.find(c => c.url.startsWith(self.location.origin));
    if(existing){
      await existing.focus();
      if(chatId) existing.postMessage({ type: 'openChat', chatId });
      return;
    }
    await clients.openWindow('/' + (chatId ? '?chat=' + encodeURIComponent(chatId) : ''));
  })());
});
