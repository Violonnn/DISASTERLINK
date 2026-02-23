<script lang="ts">
  let openMenu = $state<string | null>(null);

  function toggle(name: string) {
    openMenu = openMenu === name ? null : name;
  }

  function close() {
    openMenu = null;
  }
</script>


<div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
  <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
   <!-- Backdrop to close on outside click -->
{#if openMenu}
  <div class="fixed inset-0 z-10" on:click={close}></div>
{/if}

<div class="flex items-center justify-evenly space-x-3 md:space-x-6 bg-[#768391]/10 rounded-[20px] relative z-20 w-35">

  <!-- PFP -->
  <div class="relative">
    <div
      class="bg-white rounded-[50px] p-1 hover:cursor-pointer outline"
      on:click={() => toggle('pfp')}
    >pfp</div>

    {#if openMenu === 'pfp'}
      <div class="absolute left-0 mt-4 w-25 md:w-40 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
        <div class="px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer text-xs md:text-sm text-[#1B2E3A]">Settings</div>
      </div>
    {/if}
  </div>

  <!-- Notifs -->
  <div class="relative">
    <div class="hover:cursor-pointer" on:click={() => toggle('notifs')}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-6 h-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    </div>

    {#if openMenu === 'notifs'}
      <div class="absolute -left-14 mt-5  w-60 md:w-72 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
        <!-- Notif items — customize these later -->
        {#each [1,2,3,4,5] as n}
          <div class="px-3 py-3 hover:bg-gray-50 rounded-lg cursor-pointer border-b border-gray-50 last:border-0">
            <div class="h-4 bg-gray-100 rounded w-3/4 mb-1"></div>
            <div class="h-3 bg-gray-50 rounded w-1/2"></div>
          </div>
        {/each}
        </div>
    {/if}
  </div>

  <!-- Menu (hamburger) -->
  <div class="relative">
    <div class="hover:cursor-pointer" on:click={() => toggle('menu')}>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-6 h-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </div>

    {#if openMenu === 'menu'}
      <div class="absolute -left-26 mt-5 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
        <div class="grid grid-cols-4 gap-1 min-w-[280px]">
          <!-- Menu items — customize these later -->
          {#each ['Create Report', 'Feed', 'Map', 'Logout'] as item}
            <div class="flex flex-col items-center px-3 py-4 hover:bg-gray-50 rounded-lg cursor-pointer text-center">
              <div class="w-8 h-8 bg-gray-100 rounded-full mb-2"></div>
              <span class="text-xs text-[#1B2E3A] font-medium">{item}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

</div> 

      <h1 class="relative text-[0px] md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</h1>
      <p class="text-black text-xs md:sm font-medium hover:underline hover:cursor-pointer">Location: Minglanilla</p>

  </div>
</div>

