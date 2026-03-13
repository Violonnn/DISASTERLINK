# Notifications – Supabase setup

For resident notifications (comment/upvote on your report) to work and update in **realtime**, you need to turn on Realtime for the `notifications` table in Supabase.

## 1. Add `notifications` to the Realtime publication

**Option A – Dashboard (recommended)**

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. Go to **Database** → **Publications** (or **Replication** in some layouts).
3. Open the **supabase_realtime** publication.
4. Find **notifications** in the list and **toggle it ON**.

**Option B – SQL**

In **SQL Editor**, run:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

If you see *relation "notifications" is already a member of publication "supabase_realtime"*, the table is already enabled; no further action needed.

## 2. Allow residents to delete their own notifications

If you haven’t applied the delete policy yet, run the migration or this SQL:

```sql
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());
```

(Migration file: `supabase/migrations/20250316_notifications_delete_policy.sql`.)

## 3. Check that notifications are created

- **RLS**: The `notifications` table should have:
  - **SELECT**: `user_id = auth.uid()` (see your own).
  - **INSERT**: Policy that allows creating rows (e.g. `WITH CHECK (true)` or your system policy).
  - **UPDATE**: `user_id = auth.uid()` (mark as read).
  - **DELETE**: `user_id = auth.uid()` (from step 2).

After enabling the publication and policies, new comment/upvote notifications should appear and update in realtime in the resident dashboard and feed.
