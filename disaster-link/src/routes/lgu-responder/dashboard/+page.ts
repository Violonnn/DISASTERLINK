/**
 * Redirect /lgu-responder/dashboard → /lgu-responder (which then redirects by role).
 * Kept for existing notification links in the database.
 */
import { redirect } from '@sveltejs/kit';

export function load() {
  redirect(307, '/lgu-responder');
}
