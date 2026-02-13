<script lang="ts">
  import { supabase } from "$lib/supabase";
  import { goto } from '$app/navigation';

  let showModal = false;
  let modalType: 'login' | 'signup' = 'login';

  const openModal = (type: 'login' | 'signup') => {
    modalType = type;
    showModal = true;
  };
  const closeModal = () => showModal = false;

  let email = "";
  let password = "";
  let loading = false;

  async function handleLogin() {
    loading = true;
    
    // This tells Supabase to check the "Secret Vault" (auth.users)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
     
      // validation diri if sayop ang credential
    } else {
     goto('/general-page');
    }
    
    loading = false;
  }
  
  
</script>

{#if showModal}
  <div class="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50 ">
    <div class="bg-[#4E6883] rounded-lg shadow-lg p-6 w-150 h-90  relative">
      <img src="/imgs/login1.png" alt="" class="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      <button class="absolute top-2 right-3 text-gray-500 hover:text-gray-800" on:click={closeModal}>✕</button>
      
      {#if modalType === 'login'}
        <div class="flex flex-col items-end relative top-20 right">
          <h2 class="text-xl font-bold mb-4 relative right-25">Welcome Back!</h2>
          <input 
           bind:value={email}
           type="text"
           placeholder="Email" 
           class="w-60 border p-1 rounded-lg mb-2 text-sm"
           
           />
          <input bind:value={password}
           type="password" 
           placeholder="Password"
            class="w-60 ` border p-1 rounded-lg mb-2 text-sm"
             />

          <button 
      on:click={handleLogin}
      disabled={loading}
      class="relative right-5 w-50 bg-gray-800 text-white py-2 rounded"
    >
      {loading ? 'Loading :)).' : 'Log In'}
    </button>
        </div>
        
      {:else}
        <div class="flex flex-col items-end relative top-20 right">
          <h2 class="text-xl font-bold mb-4 relative right-28">Sign Up Now!</h2>
          <input type="text" placeholder="Username" class="w-60 border p-1 rounded mb-2 text-sm" />
          <input type="email" placeholder="Email" class="w-60 border p-1 rounded mb-2 text-sm" />
          <input type="password" placeholder="Password" class="w-60 border p-1 rounded mb-2 text-sm" />
          <button class="relative right-5 w-50 bg-gray-800 text-white py-2 rounded">Sign Up</button>
        </div>

      {/if}
    </div>
      <img src="/imgs/landing1.png" alt="" class="absolute inset-0 w-full h-full object-contain opacity-20 pointer-events-none" />
  </div>
{/if}



<div class="min-h-screen flex flex-col items-center justify-center p-6 bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] relative cursor-default">
  
<img src="/imgs/landing1.png" alt="" class="absolute inset-0 w-full h-full object-contain opacity-20 pointer-events-none" />


<div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
  <div class="max-w-screen-xl mx-auto flex justify-end items-center h-12 px-3 space-x-4">
    <h1 class="relative right-240 text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</h1>
    <a on:click={() => openModal('signup')} class="text-white text-sm font-medium hover:underline hover:cursor-pointer">Sign Up</a>
    <button on:click={() => openModal('login')} class="bg-[#768391] text-black rounded px-5 py-1 text-sm hover:bg-gray-300 transition pt-1 hover:cursor-pointer">Log In</button>
  </div>
</div>


  <h1 class="relative left-5 font-playfairsc text-4xl font-bold text-center text-[#ffffff] mb-1" style="font-family: 'Playfair Display SC', serif">Hyper Local Coordination Hub</h1>
  <p class="relative left-5 text-gray-300 text-center max-w-md mt-0 font-light">SAFETY ● COORDINATION ● TRANSPARENCY</p>


  <div class="flex space-x-4">
    <a href="gps" class="relative left-5 bg-[#768391] text-sm text-black rounded px-5 py-3 px-25 top-10 shadow-md hover:cursor-pointer">Locate My Location</a>
  </div>

  <!-- Small info cards (optional) -->
  <div class="relative grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 top-10">
    <div class="card p-4 shadow-sm bg-base-200">
      
    </div>
    <div class="card p-4 shadow-sm bg-base-200">
     
    </div>
    <div class="card p-4 shadow-sm bg-base-200">
      
    </div>
  </div>

</div>

