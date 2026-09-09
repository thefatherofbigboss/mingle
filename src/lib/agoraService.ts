import { RtcTokenBuilder, RtcRole } from 'agora-token';

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

export interface AgoraTokenParams {
  channelName: string;
  account: string; // user identifier / alias
  role?: 'publisher' | 'subscriber';
  expireSeconds?: number;
}

export function isAgoraConfigured(): boolean {
  return Boolean(AGORA_APP_ID && AGORA_APP_CERTIFICATE);
}

export function getAgoraAppId(): string {
  return AGORA_APP_ID;
}

/**
 * Generates an RTC token for an audio call session.
 */
export function generateVoiceToken({
  channelName,
  account,
  role = 'publisher',
  expireSeconds = 3600, // 1 hour default
}: AgoraTokenParams): { token: string; channelName: string; appId: string; account: string } {
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    console.warn('[AgoraService] AGORA_APP_ID or AGORA_APP_CERTIFICATE is not configured in environment variables.');
    return {
      token: '',
      channelName,
      appId: AGORA_APP_ID,
      account,
    };
  }

  const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    account,
    rtcRole,
    expireSeconds,
    expireSeconds
  );

  return {
    token,
    channelName,
    appId: AGORA_APP_ID,
    account,
  };
}
