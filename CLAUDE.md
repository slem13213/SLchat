# SLchat

Мессенджер (веб-приложение). Владелец — Богдан (GitHub: slem13213). Общаться с ним по-русски, объяснять просто.

## Стек
- Весь фронтенд — в одном файле `index.html` (~3200 строк: HTML + CSS + JS, без сборки и без npm).
- Firebase через CDN (compat SDK 10.13.0): Realtime Database, Authentication, Cloud Messaging.
- Хостинг — Netlify, деплой автоматически из ветки `main` этого репозитория. Сайт: https://slchatt.netlify.app
- `netlify/functions/send-push.js` — серверная функция для push-уведомлений через FCM HTTP v1. Ключи берутся из переменных окружения Netlify (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) — никогда не вписывать их в код.
- Есть отдельный репозиторий `SLchat-app` — Android-обёртка (.apk) над сайтом через Capacitor.

## Возможности приложения
Личные и групповые чаты, друзья и заявки в друзья, онлайн-статус и «был в сети», «печатает…», прочтения, закреплённые чаты, фото, голосовые и видеокружки, истории (stories), аудио/видеозвонки и групповые звонки (WebRTC, сигналинг через Realtime DB), push-уведомления. Вход по username (превращается в email через `usernameToEmail`).

## Структура данных в Realtime Database
`users/{uid}` (профиль, avatar, online, lastSeen, onlineVisibility, fcmTokens), `usernames/{name} → uid`, `chats/{chatId}/meta|messages|reads`, `userChats/{uid}/{chatId}`, `pinnedChats/{uid}`, `friends/{uid}`, `friendRequests/{uid}`, `typing/{chatId}`, `stories`.
Личный чат имеет id из `privateChatId(uidA, uidB)`.

## Важное
- Админ — username `slem2` (`ADMIN_USERNAME`), ему приходят логи регистраций в чат `admin_registration_log`.
- Медиа (фото, голос, видео) хранятся как data URL прямо в базе — следить за размером.
- Код регистрирует `/firebase-messaging-sw.js`, но такого файла в репозитории нет — веб-push в браузере из-за этого может не работать.

## Как работать
- Любое изменение в `main` сразу уходит на живой сайт — перед пушем проверять, что `index.html` не сломан (открывается, нет ошибок в JS).
- Коммиты небольшие, сообщения понятные.
