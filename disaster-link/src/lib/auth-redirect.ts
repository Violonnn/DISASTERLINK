/**
 * Auth redirect helpers — maps user roles to their dashboard paths.
 */

export const LGU_DASHBOARD_PATHS: Record<string, string> = {
  municipal_responder: '/lgu-responder/municipal/dashboard',
  barangay_responder: '/lgu-responder/barangay/dashboard',
  lgu_responder: '/lgu-responder/barangay/dashboard'
};

/**
 * Returns the dashboard path for an LGU role. Barangay and legacy lgu_responder go to barangay dashboard.
 */
export function getLguDashboardPath(role: string): string {
  return LGU_DASHBOARD_PATHS[role] ?? '/';
}
