<div class=" min-h-screen flex flex-col items-center justify-center relative cursor-default">
    <!-- bg-[linear-gradient(130deg,#2F4B5D_10%,#1B2E3A_100%)] -->
    <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-70 object-cover pointer-events-none" />

    <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
        <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
            <h1 class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</h1>
            <div class="flex items-center space-x-3 md:space-x-6">
            <a href="../login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
            </div>
        </div> 
    </div>

    <div class="relative bg-[#2F4B5D]/4 w-170 h-100 grid place-content-center rounded-[16px] shadow-lg">
        <div class="relative w-full flex flex-col items-center ">
            <h1 class="relative text-[#2F4B5D] text-2xl font-bold">Create your DisasterLink account</h1>
            <span class="relative top-5 text-[#2F4B5D] font-light -mt-5 text-sm">Access features to connect effectively.</span>
            <div class="relative mt-20 grid grid-cols-1 md:grid-cols-3 w-full md:w-140 place-items-center"> 
                <!-- <p class="text-xs w-full md:col-span-3 p-2">Name</p> -->
                 <div class="relative -mt-10">
                    <label for="FN" class="text-[10px] text-[#2F4B5D] md:col-span-2 w-full text-left ml-1">First Name</label>
                    <input id="FN" type="text" placeholder="Enter your First Name" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" />
                 </div>
                 <div class="relative -mt-10">
                    <label for="LN" class="text-[10px] text-[#2F4B5D] md:col-span-2 w-full text-left ml-1">Last Name</label>
                    <input id="LN" type="text" placeholder="Enter your Last Name" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" />
                 </div>
                 <div class="relative -mt-10">
                    <label for="UN" class="text-[10px] text-[#2F4B5D] md:col-span-2 w-full text-left ml-1">Username</label>
                    <input id="UN" type="text" placeholder="Enter your Username" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" />
                 </div>
                 <div class="relative -mt-2 md:col-span-2 w-full text-left ml-1">
                    <label for="EM" class="text-[10px] text-[#2F4B5D] ">Email Address</label>
                    <input id="EM" type="text" placeholder="Enter your Email" class="md:col-span-2 w-91 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" /> 
                </div>
                <div class="relative -mt-2 ">
                    <label for="PN" class="text-[10px] text-[#2F4B5D] ">Contact Number</label>
                    <input id="PN"type="telephone" placeholder="Enter your Number" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" />
                </div>
                <div class="relative -mt-2 ">
                    <label for="PASS" class="text-[10px] text-[#2F4B5D] ">Password</label>
                    <input id="PASS" type="Password" placeholder="Enter Password" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F]" />
                </div>
                <input type="Password" placeholder="Confirm password" class="w-45 border p-1 rounded-lg mb-2 text-xs text-[#0C212F] mt-4" />
                 
                
                <button class="w-10 md:w-25 h-10 md:h-8 bg-gray-800 text-xs md:text-sm text-white rounded col-start-3 flex items-center justify-center">Next</button>
            </div>
        </div>

        <div class="relative grid grid-cols-1 md:grid-cols-1 gap-4 mt-5">
            <p class="text-xs w-full md:col-start-1 justify-self-center text-center font-light">OR</p>
                <button class="flex text-sm card p-4 shadow-sm bg-base-200 w-70 h-15 rounded justify-self-center justify-items-center gap-10">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#1B2E3A"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#1B2E3A"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#1B2E3A"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 1.16-4.53z" fill="#1B2E3A"/>
                    </svg>
                    <span class="text-slate-700 font-medium">Continue with Google</span>
                </button>
            <!-- <div class=" text-sm card p-4 shadow-sm bg-base-200 w-100 h-15 rounded justify-self-center justify-items-center grid place-items-center">Continue with Google</div> -->
        </div>
    </div>
</div>

