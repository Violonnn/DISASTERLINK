<script lang="ts">
  /**
   * Guest Dashboard — map view for unauthenticated users.
   * Shows hazard layers, search, GPS, and barangay status (realtime).
   */
  import MapDashboard from '$lib/components/MapDashboard.svelte';

  const menuItems = [
    { label: 'Map', href: '/guest-dashboard' },
    { label: 'Sign Up', href: '/signup' },
    { label: 'Log In', href: '/login' }
  ];
</script>

<MapDashboard
  mode="guest"
  userLabel="Guest User"
  {menuItems}
/>
