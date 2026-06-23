import { isSupported, getMessaging, getToken, onMessage, type MessagePayload } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import { db, firebaseApp } from './firebase';

const getVapidKey = (): string | undefined => {
  return (import.meta as unknown as { env?: { VITE_FIREBASE_VAPID_KEY?: string } }).env?.VITE_FIREBASE_VAPID_KEY;
};

const tokenHash = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const getMessagingIfSupported = async () => {
  if (typeof window === 'undefined') return null;
  const supported = await isSupported();
  if (!supported) return null;
  return getMessaging(firebaseApp);
};

export const registerGuardianPushToken = async (guardianUid: string, monitorUserUid: string): Promise<string | null> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;

  const messaging = await getMessagingIfSupported();
  if (!messaging) return null;

  if (!('Notification' in window)) return null;

  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  if (Notification.permission !== 'granted') {
    return null;
  }

  const vapidKey = getVapidKey();
  if (!vapidKey) {
    return null;
  }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) return null;

  const key = tokenHash(token);
  await set(ref(db, `notificationTokens/${guardianUid}/${key}`), {
    token,
    role: 'guardian',
    monitorUserUid,
    userAgent: navigator.userAgent,
    updatedAt: Date.now(),
  });

  return token;
};

export const subscribeForegroundPushMessages = (handler: (payload: MessagePayload) => void): (() => void) => {
  let active = true;
  let unsubscribe = () => {};

  void (async () => {
    const messaging = await getMessagingIfSupported();
    if (!messaging || !active) return;
    unsubscribe = onMessage(messaging, handler);
  })();

  return () => {
    active = false;
    unsubscribe();
  };
};
