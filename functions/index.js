const { onValueCreated } = require('firebase-functions/v2/database');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const buildMessage = (alert) => {
  const title = typeof alert?.title === 'string' ? alert.title : 'Guardian Alert';
  const body = typeof alert?.body === 'string' ? alert.body : 'New update from monitored user.';

  return {
    title,
    body,
  };
};

exports.pushGuardianAlert = onValueCreated(
  {
    ref: '/guardianAlerts/{guardianUid}/{alertId}',
    region: 'asia-south1',
  },
  async (event) => {
    const { guardianUid } = event.params;
    const alert = event.data.val();

    if (!guardianUid || !alert) {
      return;
    }

    const tokenSnap = await getDatabase().ref(`notificationTokens/${guardianUid}`).get();
    const tokenEntries = tokenSnap.val() || {};

    const tokens = Object.values(tokenEntries)
      .map((entry) => entry && typeof entry.token === 'string' ? entry.token : null)
      .filter((token) => typeof token === 'string');

    if (tokens.length === 0) {
      logger.info('No notification tokens found for guardian', { guardianUid });
      return;
    }

    const message = buildMessage(alert);

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: message.title,
        body: message.body,
      },
      data: {
        type: String(alert.type || 'status_update'),
        userUid: String(alert.userUid || ''),
        userName: String(alert.userName || ''),
        createdAt: String(alert.createdAt || Date.now()),
        title: message.title,
        body: message.body,
      },
      webpush: {
        fcmOptions: {
          link: '/',
        },
      },
    });

    const invalidTokenHashes = [];
    const tokenHashes = Object.keys(tokenEntries);

    response.responses.forEach((result, index) => {
      if (result.success) return;

      const code = result.error && result.error.code;
      if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
        const tokenHash = tokenHashes[index];
        if (tokenHash) {
          invalidTokenHashes.push(tokenHash);
        }
      }
    });

    if (invalidTokenHashes.length > 0) {
      await Promise.all(invalidTokenHashes.map((tokenHash) => (
        getDatabase().ref(`notificationTokens/${guardianUid}/${tokenHash}`).remove()
      )));
    }
  }
);
