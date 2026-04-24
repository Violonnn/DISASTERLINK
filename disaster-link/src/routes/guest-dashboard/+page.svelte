<script lang="ts">
  /**
   * Guest Dashboard — map view for unauthenticated users.
   * Shows hazard layers, search, GPS, and barangay status (realtime).
   */
  import MapDashboard from '$lib/components/MapDashboard.svelte';
  import { goto } from '$app/navigation';
  // Guest profile dropdown actions.
  const pfpMenuItems = [
    {
      label: 'Register',
      href: '/signup/resident'
    },
    {
      label: 'Back',
      action: () => goto('/')
    }
  ];
</script>

<MapDashboard
  mode="guest"
  userLabel="Guest User"
  {pfpMenuItems}
/>
