<script lang="ts">
/**
 * Privacy Policy Page
 */
import VMark from '$lib/components/brand/VMark.svelte';
import Wordmark from '$lib/components/brand/Wordmark.svelte';
</script>

<svelte:head>
  <title>Privacy Policy · Versifine</title>
  <meta name="description" content="Privacy Policy for the Versifine personal finance platform." />
  <link
    href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div
  class="legal-page grid min-h-screen w-full lg:grid-cols-12"
  style="
    --background: oklch(1 0 0);
    --foreground: oklch(0.18 0.005 260);
    --muted-foreground: oklch(0.55 0.008 260);
    --border: oklch(0.92 0.004 260);
    --secondary: oklch(0.975 0.002 260);
    --brand: oklch(0.32 0.18 268);
    --brand-deep: oklch(0.24 0.16 268);
    background: var(--background);
    color: var(--foreground);
    font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif;
  "
>
  <!-- Left Brand Rail -->
  <aside
    class="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex lg:col-span-4 xl:p-14"
    style="background: linear-gradient(160deg, oklch(0.32 0.18 268) 0%, oklch(0.22 0.16 268) 60%, oklch(0.16 0.12 268) 100%);"
  >
    <!-- Aurora blobs -->
    <div
      aria-hidden="true"
      class="animate-aurora pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full"
      style="background: radial-gradient(closest-side, oklch(0.55 0.22 290 / 0.55), transparent 70%); filter: blur(40px);"
    ></div>
    
    <div
      aria-hidden="true"
      class="animate-drift pointer-events-none absolute -bottom-32 -right-32 w-[420px] select-none opacity-[0.07]"
    >
      <VMark class="w-full" />
    </div>

    <!-- Header -->
    <a href="/" class="relative z-10 inline-flex items-center self-start" aria-label="Versifine home">
      <Wordmark class="h-[22px] w-auto text-white" />
    </a>

    <!-- Brand Quote -->
    <div class="relative z-10 flex flex-1 items-center">
      <div class="max-w-xs">
        <span aria-hidden="true" class="mb-4 inline-block h-px w-7 bg-white/45"></span>
        <h2 class="text-xl font-light leading-snug tracking-tight text-white/90">
          Privacy that does something. Your transaction details are kept private, and run locally in-browser in Privacy Mode.
        </h2>
      </div>
    </div>

    <!-- Footer -->
    <footer class="relative z-10 text-[12px] text-white/45">
      <span>© {new Date().getFullYear()} Versifine, Inc.</span>
    </footer>
  </aside>

  <!-- Main Content -->
  <main class="relative flex flex-col overflow-hidden lg:col-span-8">
    <VMark
      class="pointer-events-none absolute -right-40 -top-32 w-[460px] select-none"
      style="opacity: 0.03;"
    />

    <header class="relative z-10 flex items-center px-6 py-6 sm:px-10 lg:px-14">
      <a href="/" class="flex items-center lg:hidden" aria-label="Versifine home">
        <Wordmark class="h-6 w-auto text-[var(--brand)]" />
      </a>
      <a href="/" class="ml-auto text-[13px] font-medium transition-colors hover:opacity-85" style="color: var(--brand);">
        ← Back to landing
      </a>
    </header>

    <article class="vf-legal-scroll relative z-10 flex-1 overflow-y-auto px-6 pb-20 sm:px-10 lg:px-14">
      <div class="max-w-2xl">
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p class="mt-2 text-sm text-[var(--muted-foreground)]">Effective Date: June 5, 2026</p>
        
        <div class="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700">
          <p>
            At Versifine, Inc. ("Versifine", "we", "us", or "our"), your privacy is a foundational design requirement. 
            We build tools to capture and understand your personal finance data with minimum friction, but doing so 
            obligates us to be transparent, precise, and secure with how your information is handled. 
          </p>
          <p>
            This Privacy Policy applies to our website, SvelteKit web dashboard, APIs, WhatsApp integration (our bot), 
            and all associated products and services.
          </p>

          <hr class="border-[var(--border)]" />

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">1. Data We Collect</h2>
            <p>We process the following types of information when you register, log in, or interact with our system:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>Account Credentials:</strong> Email addresses, hashed passwords (via bcrypt), and names.</li>
              <li><strong>Verification Details:</strong> Phone numbers linked via WhatsApp and one-time verification tokens.</li>
              <li><strong>Financial Transactions:</strong> Captured expenses, income, transfers, merchants, amounts, categories, and wallet balances.</li>
              <li><strong>Multimodal Inbound Media:</strong> User-submitted text, receipt photos/images, and voice notes captured either on the web dashboard or forwarded via the Meta/WhatsApp Cloud APIs.</li>
              <li><strong>System Logs:</strong> IP addresses, request identifiers, browser agent configuration, and anonymized performance metrics.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">2. How We Collect Data</h2>
            <p>Data enters the Versifine ecosystem through these channels:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>Direct User Input:</strong> Fields completed on the web app or entries entered into our dashboard omnibar.</li>
              <li><strong>WhatsApp/Meta integration:</strong> Text messages, image buffers, or voice files forwarded by Meta Webhook challenges and APIs to our server endpoints.</li>
              <li><strong>Local Storage & Cookies:</strong> Persistent browser settings (such as theme and language choices).</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">3. Why We Process Your Data</h2>
            <p>Your information is used strictly to power core product operations:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>Onboarding & Automation:</strong> Creating your multi-tenant personal workspace, attaching wallets, and linking WhatsApp devices.</li>
              <li><strong>AI Extraction & Transcription:</strong> Processing voice notes (speech-to-text) and receipt images (optical character recognition) to identify transaction details like amounts, currencies, and descriptions.</li>
              <li><strong>Categorization:</strong> Categorizing merchants using our override rules, database match tables, or our lightweight local ML model.</li>
              <li><strong>Copilot Interactions:</strong> Querying database records in response to your questions via the AI copilot panel or bot thread.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">4. Sharing and Third-Party API Processors</h2>
            <p>
              We do not sell, rent, or trade your data. To provide real-time features, the following third-party infrastructure components are integrated into the pipeline:
            </p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>Meta Platforms (WhatsApp):</strong> Incoming message routing and outbound service replies.</li>
              <li><strong>OpenAI APIs:</strong> Transcriptions (Whisper), receipt vision extraction (GPT models), and copilot RAG grounding. The raw text and media are passed to OpenAI solely for immediate inference and are never used to train public models.</li>
              <li><strong>Cloud and Hosting Vendors:</strong> Secure EC2 instances and database hosts running Postgres + pgvector.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">5. Privacy Mode (In-Browser Processing)</h2>
            <p>
              For users desiring maximum privacy, Versifine includes a <strong>Privacy Mode</strong>. When toggled in your web settings:
            </p>
            <p class="italic bg-[var(--secondary)] border-l-2 border-[var(--brand)] p-3 text-sm rounded-r-md">
              A 30 MB MiniLM classification model is loaded directly into your browser's thread. Categorization is performed locally on your device, and the raw description text is never uploaded to our servers.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">6. Data Retention and Deletion</h2>
            <p>
              We store transaction records and account profiles until you explicitly request deletion. 
              You can trigger a complete delete of your personal record and transaction ledgers at any time.
            </p>
            <p>
              Detailed data removal instructions are available on our dedicated 
              <a href="/data-deletion" class="underline hover:text-[var(--brand)] font-medium">Data Deletion Instructions</a> page.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">7. Contact Information</h2>
            <p>
              If you have any questions about this Privacy Policy, your rights, or wish to submit an access request, 
              please contact us at:
            </p>
            <p class="font-medium">
              Email: <a href="mailto:privacy@versifine.com" class="underline text-[var(--brand)]">privacy@versifine.com</a>
            </p>
          </section>
        </div>
      </div>
    </article>
  </main>
</div>

<style>
  /* Subtle animations matching sign-in page */
  @keyframes drift {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    50% { transform: translate(-15px, -20px) rotate(-2deg); }
  }
  @keyframes aurora {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
    50% { transform: translate(30px, -20px) scale(1.1); opacity: 0.75; }
  }
  .animate-drift { animation: drift 18s ease-in-out infinite; }
  .animate-aurora { animation: aurora 14s ease-in-out infinite; }
  
  .legal-page {
    height: 100vh;
    overflow: hidden;
  }
  
  .vf-legal-scroll {
    scrollbar-width: thin;
  }
</style>
