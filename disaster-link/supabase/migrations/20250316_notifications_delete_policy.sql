-- Allow users to delete their own notifications (for "Delete" in notification panel).
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE
  USING (user_id = auth.uid());
