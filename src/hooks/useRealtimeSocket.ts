import { useEffect, useRef, useState, useCallback } from 'react';
import type { UserProfile, OnlineUser } from '../types';

export type ServerEvent = Record<string, unknown>;

export function useRealtimeSocket(
  profile: UserProfile,
  onEvent: (event: ServerEvent) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const pendingQueueRef = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;

    function connect() {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: 'auth:identify',
            userId: profileRef.current.id,
            name: profileRef.current.name,
            color: profileRef.current.color,
          })
        );
        while (pendingQueueRef.current.length > 0) {
          const queued = pendingQueueRef.current.shift();
          if (queued) ws.send(queued);
        }
      };

      ws.onmessage = (evt) => {
        let parsed: ServerEvent;
        try {
          parsed = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        if (parsed.type === 'session:welcome') {
          setClientId(String(parsed.clientId || ''));
          if (Array.isArray(parsed.users)) {
            setOnlineUsers(parsed.users as OnlineUser[]);
          }
        } else if (parsed.type === 'presence:update') {
          if (Array.isArray(parsed.users)) {
            setOnlineUsers(parsed.users as OnlineUser[]);
          }
        }
        onEventRef.current(parsed);
      };

      ws.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 1800);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'auth:identify',
          userId: profile.id,
          name: profile.name,
          color: profile.color,
        })
      );
    }
  }, [profile.id, profile.name, profile.color]);

  const sendEvent = useCallback((payload: Record<string, unknown>) => {
    const raw = JSON.stringify(payload);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    } else {
      pendingQueueRef.current.push(raw);
    }
  }, []);

  return {
    connected,
    clientId,
    onlineUsers,
    sendEvent,
  };
}
