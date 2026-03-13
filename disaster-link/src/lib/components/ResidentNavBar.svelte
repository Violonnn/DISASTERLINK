<script lang="ts">
  /**
   * ResidentNavBar — shared top navigation for resident pages (Feed, Settings, etc.).
   * Mirrors the MapDashboard header style: dark background, DISASTERLINK center title,
   * profile button, notification bell, and hamburger menu on the left pill.
   */
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import { clearResidentLocation } from '$lib/services/resident-location-session';

  interface MenuItem {
    label: string;
    href?: string;
    action?: () => void;
    icon?: string;
  }

  interface Props {
    userLabel?: string;
    userInitials?: string;
    residentBarangayName?: string;
    pfpMenuItems?: MenuItem[];
    hamburgerMenuItems?: MenuItem[];
    /** Current route path — used to highlight the active menu item */
    currentPath?: string;
  }

  let {
    userLabel = 'Resident',
    userInitials = 'R',
    residentBarangayName = '',
    pfpMenuItems = [],
    hamburgerMenuItems = [],
    currentPath = ''
  }: Props = $props();

  /* Controls which dropdown is open; null means all closed */
  let openMenu = $state<string | null>(null);

  function toggle(name: string) {
    openMenu = openMenu === name ? null : name;
  }

  function close() {
    openMenu = null;
  }

  function handleNavigation(item: MenuItem) {
    close();
    if (item.href) {
      goto(item.href);
    } else if (item.action) {
      item.action();
    }
  }

  /* SVG icons injected into the menu for the hamburger items — defined here as constants */
  const feedIcon   = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" /></svg>`;
  const mapIcon    = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 0 1 15 0Z" /></svg>`;
  const settingsIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;
  const logoutIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>`;

  /* Default hamburger items if none provided from parent */
  const defaultHamburgerItems: MenuItem[] = [
    { label: 'Feed',     href: '/resident/feed',      icon: feedIcon     },
    { label: 'Map',      href: '/resident/dashboard',  icon: mapIcon      },
    { label: 'Settings', href: '/resident/settings',   icon: settingsIcon },
    {
      label: 'Logout',
      action: async () => {
        // Clear any saved resident location when logging out from the navbar menu.
        clearResidentLocation();
        await supabase.auth.signOut();
        goto('/login');
      },
      icon: logoutIcon
    }
  ];

  const resolvedHamburgerItems = $derived(
    hamburgerMenuItems.length > 0 ? hamburgerMenuItems : defaultHamburgerItems
  );

  const resolvedPfpItems = $derived(
    pfpMenuItems.length > 0 ? pfpMenuItems : [
      { label: 'Settings', href: '/resident/settings' },
      {
        label: 'Logout',
        action: async () => {
          clearResidentLocation();
          await supabase.auth.signOut();
          goto('/login');
        }
      }
    ]
  );

  /* Compute display initials from userLabel if userInitials is empty */
  const displayInitials = $derived(
    userInitials ||
    userLabel.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() ||
    'R'
  );
</script>

<header class="h-12 md:h-14 shrink-0 bg-[#0C212F]/95 shadow-md z-50 border-b border-white/10 fixed top-0 left-0 right-0">
  <div class="h-full mx-auto flex items-center justify-between gap-2 px-3 md:px-4 max-w-screen-xl relative">

    <!-- Left: pill with profile, notification bell, and hamburger -->
    <div class="flex items-center gap-2 md:gap-3 relative z-20 shrink-0">
      {#if openMenu}
        <button class="fixed inset-0 z-10 cursor-default" onclick={close} aria-label="Close menu"></button>
      {/if}

      <div class="flex items-center gap-2 bg-[#768391]/10 rounded-full px-2 md:px-3 py-1 relative z-20">

        <!-- Notification bell: hidden on feed page (icon is in left panel beside notifications) -->
        {#if currentPath !== '/resident/feed'}
          <div class="relative">
            <button class="cursor-pointer p-1 touch-manipulation" onclick={() => toggle('notifs')} aria-label="Notifications">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75v-.7V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
            </button>
            {#if openMenu === 'notifs'}
              <div class="absolute left-0 mt-3 w-72 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30">
                <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                  <span class="text-[#1B2E3A] text-xs font-semibold">Notifications</span>
                  <button onclick={close} class="text-gray-400 hover:text-[#1B2E3A] text-sm cursor-pointer" aria-label="Close">&times;</button>
                </div>
                <p class="px-3 py-4 text-gray-500 text-xs">No notifications.</p>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Hamburger menu: hidden on feed page (feed has its own left panel + Map/Feed/Report) -->
        {#if currentPath !== '/resident/feed'}
          <div class="relative">
            <button class="cursor-pointer p-1 touch-manipulation" onclick={() => toggle('menu')} aria-label="Menu">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="white" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {#if openMenu === 'menu'}
              <div class="absolute left-0 mt-3 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-30 min-w-[200px] md:min-w-[220px]">
                <div class="p-2">
                  <div class="grid grid-cols-4 gap-1">
                    {#each resolvedHamburgerItems as item}
                      {#if item.href}
                        <a
                          href={item.href}
                          class="flex flex-col items-center px-2 py-3 rounded-lg text-center touch-manipulation {currentPath === item.href ? 'bg-gray-100' : 'hover:bg-gray-50'}"
                          onclick={close}
                        >
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5 flex items-center justify-center">
                            {#if item.icon}{@html item.icon}{/if}
                          </div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium leading-tight">{item.label}</span>
                        </a>
                      {:else if item.action}
                        <button
                          class="flex flex-col items-center px-2 py-3 hover:bg-gray-50 rounded-lg text-center touch-manipulation w-full"
                          onclick={() => { item.action?.(); close(); }}
                        >
                          <div class="w-7 h-7 bg-gray-100 rounded-full mb-1.5 flex items-center justify-center">
                            {#if item.icon}{@html item.icon}{/if}
                          </div>
                          <span class="text-[10px] text-[#1B2E3A] font-medium leading-tight">{item.label}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {/if}

      </div>
    </div>

    <!-- Center: DISASTERLINK title + current location / affiliated barangay -->
    <div class="flex flex-col items-center justify-center gap-0.5 absolute left-1/2 -translate-x-1/2 pointer-events-none">
      <h1 class="text-sm text-gray-400 tracking-wider select-none" style="font-family: 'Playfair Display SC', serif">
        DISASTERLINK
      </h1>
      {#if residentBarangayName}
        <p class="text-white text-[10px] sm:text-xs text-center whitespace-nowrap overflow-hidden max-w-[90vw] md:max-w-md text-ellipsis">
          <span class="text-white/70">Barangay:</span>
          <span class="text-white/95">{residentBarangayName}</span>
        </p>
      {/if}
    </div>

    <!-- Right: invisible spacer to balance the flex layout -->
    <div class="w-[1px] shrink-0" aria-hidden="true"></div>

  </div>
</header>
