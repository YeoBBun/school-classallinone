import { useSyncExternalStore } from 'react';
import { googleEmail, hasCalendarScope, hasToken, isConfigured, onGoogleChange, wasConnected } from './google';

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  /** 연결했었는데 끝났다 → [다시 연결] */
  expired: boolean;
  email: string;
  calendar: boolean;
}

let cache: { key: string; value: GoogleStatus } | null = null;

function snapshot(): GoogleStatus {
  const connected = hasToken();
  const value: GoogleStatus = {
    configured: isConfigured,
    connected,
    expired: !connected && wasConnected(),
    email: googleEmail(),
    calendar: hasCalendarScope(),
  };
  const key = JSON.stringify(value);
  if (cache?.key !== key) cache = { key, value };
  return cache.value;
}

/** 구글 연결 상태 (연결·끊김이 바뀌면 다시 그린다) */
export function useGoogle(): GoogleStatus {
  return useSyncExternalStore(onGoogleChange, snapshot);
}
