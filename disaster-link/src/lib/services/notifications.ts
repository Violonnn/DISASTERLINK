/**
 * Notifications Service
 * ─────────────────────
 * Fetch and mark notifications (e.g. assistance offered to your barangay).
 */

import { supabase } from '$lib/supabase';

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Fetch recent notifications for the current user.
 */
export async function fetchNotifications(userId: string, limit = 20): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, link, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at
  }));
}

/**
 * Count unread notifications for the current user.
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) return 0;
  return count ?? 0;
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  return { error: error?.message ?? null };
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllNotificationsRead(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  return { error: error?.message ?? null };
}
