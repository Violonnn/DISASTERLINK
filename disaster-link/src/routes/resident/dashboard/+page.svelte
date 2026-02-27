<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabase';
    import { goto } from '$app/navigation';

    /* ── Dropdown menu state ── */
    let openMenu = $state<string | null>(null);

    /* ── Session / profile state ── */
    let isLoading = $state(true);
    let profile = $state<{ first_name: string; last_name: string; role: string } | null>(null);

    /* Toggle a dropdown; close if already open */
    function toggle(name: string) {
        openMenu = openMenu === name ? null : name;
    }

    /* Close any open dropdown (backdrop click) */
    function close() {
        openMenu = null;
    }

    /* Sign the user out and redirect to login */
    async function handleSignout() {
        await supabase.auth.signOut();
        goto('/login');
    }

    /* On page load: verify session exists, fetch profile, guard access */
    onMount(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                goto('/login');
                return;
            }

            const { data } = await supabase
                .from('profiles')
                .select('first_name, last_name, role')
                .eq('id', session.user.id)
                .single();

            if (!data || data.role !== 'resident') {
                await supabase.auth.signOut();
                goto('/login');
                return;
            }

            profile = data;
        } finally {
            isLoading = false;
        }
    });

    /* Menu items with click handlers — Logout calls handleSignout */
    const menuItems = [
        { label: 'Create Report', action: () => {} },
        { label: 'Feed',          action: () => {} },
        { label: 'Map',           action: () => {} },
        { label: 'Logout',        action: handleSignout }
    ];
</script>

<!-- Show nothing while verifying session -->
{#if isLoading}
    <div class="min-h-screen grid place-items-center">
        <svg class="animate-spin h-8 w-8 text-[#2F4B5D]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
    </div>
{:else}

<div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
    <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">

        <!-- Backdrop to close on outside click -->
        {#if openMenu}
            <button class="fixed inset-0 z-10 cursor-default" onclick={close} aria-label="Close menu"></button>
        {/if}

        <div class="flex items-center justify-evenly space-x-3 md:space-x-6 bg-[#768391]/10 rounded-[20px] relative z-20 w-35">

            <!-- PFP -->
            <div class="relative">
                <button
                    class="bg-white rounded-[50px] p-1 hover:cursor-pointer outline text-xs"
                    onclick={() => toggle('pfp')}
                >
                    {profile?.first_name?.[0]}{profile?.last_name?.[0]}
                </button>

                {#if openMenu === 'pfp'}
                    <div class="absolute left-0 mt-4 w-25 md:w-40 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
                        <p class="px-3 py-1 text-[10px] text-gray-400">{profile?.first_name} {profile?.last_name}</p>
                        <div class="px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer text-xs md:text-sm text-[#1B2E3A]">Settings</div>
                    </div>
                {/if}
            </div>

            <!-- Notifs -->
            <div class="relative">
                <button class="hover:cursor-pointer" onclick={() => toggle('notifs')} aria-label="Notifications">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                </button>

                {#if openMenu === 'notifs'}
                    <div class="absolute -left-14 mt-5 w-60 md:w-72 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
                        {#each [1, 2, 3, 4, 5] as _}
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
                <button class="hover:cursor-pointer" onclick={() => toggle('menu')} aria-label="Menu">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                </button>

                {#if openMenu === 'menu'}
                    <div class="absolute -left-26 mt-5 bg-white rounded-xl shadow-lg border border-gray-100 p-2 z-30">
                        <div class="grid grid-cols-4 gap-1 min-w-[280px]">
                            {#each menuItems as item}
                                <button
                                    class="flex flex-col items-center px-3 py-4 hover:bg-gray-50 rounded-lg cursor-pointer text-center"
                                    onclick={item.action}
                                >
                                    <div class="w-8 h-8 bg-gray-100 rounded-full mb-2"></div>
                                    <span class="text-xs text-[#1B2E3A] font-medium">{item.label}</span>
                                </button>
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

{/if}
