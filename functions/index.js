import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

const MAX_FCM_TOKENS = 10;

export const sendChatNotification = onDocumentCreated(
  {
    document:
      'chatConversations/{conversationId}/messages/{messageId}',
    region: 'asia-southeast1',
  },
  async (event) => {
    const messageSnap = event.data;

    if (!messageSnap) {
      return;
    }

    const message = messageSnap.data();

    const senderId = String(
      message?.senderId || '',
    ).trim();

    const body = String(
      message?.body || '',
    ).trim();

    const conversationId =
      event.params.conversationId;

    if (!senderId || !body || !conversationId) {
      logger.warn(
        'Chat message missing required fields',
        {
          senderId,
          conversationId,
        },
      );

      return;
    }

    // Get the parent conversation.
    const conversationRef = db.doc(
      `chatConversations/${conversationId}`,
    );

    const conversationSnap =
      await conversationRef.get();

    if (!conversationSnap.exists) {
      logger.warn(
        'Conversation does not exist',
        { conversationId },
      );

      return;
    }

    const conversation =
      conversationSnap.data() || {};

    const memberIds =
      Array.isArray(conversation.memberIds)
        ? conversation.memberIds
        : [];

    // Never notify the sender.
    const recipientIds = memberIds.filter(
      (uid) => uid !== senderId,
    );

    if (recipientIds.length === 0) {
      return;
    }

    const isGroup =
      conversation.type === 'group';

    const senderInfo =
      conversation.members?.[senderId] || {};

    const senderName =
      String(
        senderInfo.name || 'Student',
      ).trim() || 'Student';

    const groupTitle =
      String(
        conversation.title ||
          'Group chat',
      ).trim() || 'Group chat';

    const title = isGroup
      ? `New message from ${groupTitle}`
      : `New message from ${senderName}`;

    const peerEmail = isGroup
      ? `${memberIds.length} members`
      : String(
          senderInfo.email || '',
        );

    for (const recipientId of recipientIds) {
      try {
        const userRef = db.doc(
          `chatUsers/${recipientId}`,
        );

        const userSnap =
          await userRef.get();

        if (!userSnap.exists) {
          continue;
        }

        const user =
          userSnap.data() || {};

        const tokens = Array.from(
          new Set(
            (Array.isArray(user.fcmTokens)
              ? user.fcmTokens
              : []
            )
              .map((token) =>
                String(token || '').trim(),
              )
              .filter(Boolean),
          ),
        ).slice(0, MAX_FCM_TOKENS);

        if (tokens.length === 0) {
          logger.info(
            'Recipient has no FCM tokens',
            { recipientId },
          );

          continue;
        }

        const data = {
          type: 'chat',
          conversationId: String(
            conversationId,
          ),
          peerName: isGroup
            ? groupTitle
            : senderName,
          peerEmail,
          isGroup: isGroup ? '1' : '0',
        };

        const response =
          await messaging.sendEachForMulticast({
            tokens,

            notification: {
              title,
              body: body.slice(0, 180),
            },

            data,

            android: {
              priority: 'high',

              notification: {
                channelId: 'chat-messages',
                sound: 'default',
                notificationPriority:
                  'PRIORITY_HIGH',
              },
            },

            apns: {
              payload: {
                aps: {
                  sound: 'default',
                },
              },
            },
          });

        logger.info(
          'FCM chat notification result',
          {
            recipientId,
            successCount:
              response.successCount,
            failureCount:
              response.failureCount,
          },
        );

        // Remove invalid/unregistered tokens.
        if (
          response.failureCount > 0
        ) {
          const invalidTokens = [];

          response.responses.forEach(
            (result, index) => {
              if (result.success) {
                return;
              }

              const code =
                result.error?.code || '';

              if (
                code ===
                  'messaging/registration-token-not-registered' ||
                code ===
                  'messaging/invalid-registration-token'
              ) {
                invalidTokens.push(
                  tokens[index],
                );
              }
            },
          );

          if (invalidTokens.length > 0) {
            const nextTokens =
              tokens.filter(
                (token) =>
                  !invalidTokens.includes(
                    token,
                  ),
              );

            await userRef.update({
              fcmTokens: nextTokens,
            });
          }
        }
      } catch (error) {
        logger.error(
          'Could not send FCM chat notification',
          {
            recipientId,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      }
    }
  },
);
