'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { NotificationDocument } from '@/types/firestore';

interface NotificationsContextType {
  notifications: NotificationDocument[];
  unreadCount: number;
  loading: boolean;
}

const NotificationsContext = createContext<NotificationsContextType>({
  notifications: [],
  unreadCount: 0,
  loading: true,
});

export function NotificationsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const { userData } = useUserData();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  // Track IDs seen so far to detect newly arrived notifications
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  // Register Electron toast click → navigate listener once on mount
  useEffect(() => {
    if (!window.electronAPI?.notifications) return;
    window.electronAPI.notifications.onNavigate((url) => {
      router.push(url);
    });
    window.electronAPI.notifications.onPlaySound(() => {
      const audio = new Audio('/mixkit-message-pop-alert-2354.mp3');
      audio.play().catch((err) => console.error('[Sound] play error:', err));
    });
    return () => {
      window.electronAPI?.notifications.removeNavigateListener();
      window.electronAPI?.notifications.removePlaySoundListener();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      seenIdsRef.current = new Set();
      initialLoadDoneRef.current = false;
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('dismissedByUser', '==', false),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<NotificationDocument, 'id'>),
        }));

        setNotifications(docs);
        setLoading(false);

        // Fire Electron toast + sound for newly arrived unread notifications.
        // Skip on the very first load (would toast all existing ones on startup).
        if (initialLoadDoneRef.current) {
          const prefs = userData?.notificationPreferences;
          const desktopEnabled = prefs?.desktopEnabled !== false; // default true
          const soundEnabled = prefs?.soundEnabled !== false;     // default true

          for (const doc of docs) {
            if (!doc.read && !seenIdsRef.current.has(doc.id)) {
              if ((desktopEnabled || soundEnabled) && window.electronAPI?.notifications) {
                window.electronAPI.notifications.show({
                  title: doc.title,
                  body: doc.message,
                  playSound: soundEnabled,
                  actionUrl: doc.actionUrl,
                });
              }
            }
          }
        } else {
          initialLoadDoneRef.current = true;
        }

        // Update seen set
        seenIdsRef.current = new Set(docs.map((d) => d.id));
      },
      (error) => {
        console.error('[useNotifications] Snapshot error:', error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  // userData.notificationPreferences intentionally omitted — we read it inside the callback
  // via the ref-like closure; adding it would re-subscribe unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
