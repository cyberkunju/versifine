<script lang="ts">
/**
 * Data Deletion Page
 */
import VMark from '$lib/components/brand/VMark.svelte';
import Wordmark from '$lib/components/brand/Wordmark.svelte';
</script>

<svelte:head>
  <title>Data Deletion Instructions · Versifine</title>
  <meta name="description" content="Instructions for requesting deletion of account and transaction data on the Versifine personal finance platform." />
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
          Control of your data is a fundamental right. Request data deletion at any time, and we will purge your record.
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
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Data Deletion Instructions</h1>
        <p class="mt-2 text-sm text-[var(--muted-foreground)]">Effective Date: June 5, 2026</p>
        
        <div class="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700">
          <p>
            At Versifine, Inc., we respect your ownership and control over your personal financial data. 
            If you decide to stop using our platform, you can request a complete, permanent erasure of 
            your account and associated transaction details.
          </p>
          <p>
            Below are instructions detailing how to submit a deletion request, what specific information 
            is removed, and how long the process takes.
          </p>

          <hr class="border-[var(--border)]" />

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">1. How to Request Deletion</h2>
            <p>
              To request deletion of your account and all associated personal data, please send an email 
              from your registered email address with the following details:
            </p>
            <div class="bg-[var(--secondary)] border-l-2 border-[var(--brand)] p-4 rounded-r-md text-sm space-y-2">
              <p><strong>To:</strong> <a href="mailto:privacy@versifine.com" class="underline text-[var(--brand)]">privacy@versifine.com</a></p>
              <p><strong>Subject:</strong> Data Deletion Request</p>
              <p><strong>Body:</strong> Please delete my Versifine account. [Include your registered email address and linked WhatsApp phone number, if any]</p>
            </div>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">2. What Data is Deleted</h2>
            <p>Once your deletion request is processed, the following information is permanently and irreversibly removed from our active database servers:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>Account Credentials:</strong> Hashed passwords, display names, and primary language settings.</li>
              <li><strong>Transaction Data:</strong> Saved transaction ledgers, amounts, currencies, categories, and merchant metadata.</li>
              <li><strong>Linked Accounts & API Sessions:</strong> Linked WhatsApp phone number connections, configuration states, and verification tokens.</li>
              <li><strong>Inbound Media & AI Transcripts:</strong> Multi-modal uploads, including receipt photos, transcription buffers, and voice messages processed by the parser or AI co-pilot.</li>
              <li><strong>Vector Embeddings:</strong> Hashed vector representations of your transactions stored for RAG grounding.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">3. Retention and Legal Disclaimers</h2>
            <p>While we make every effort to purge all user data, some information may persist temporarily for operational and security reasons:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong>System Logs:</strong> Anonymized HTTP connection logs, request identifiers, and error reports are retained for up to 90 days to diagnose infrastructure issues and prevent abuse, after which they are permanently deleted.</li>
              <li><strong>Backup snapshots:</strong> Secure, encrypted database snapshots are automatically rotated and overwritten within 30 days. Once overwritten, the backup copy containing your data ceases to exist.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">4. Processing Time</h2>
            <p>
              Our operations and security team processes data deletion requests within <strong>7 business days</strong> 
              of receipt. Once the deletion is complete, you will receive a confirmation email at your registered address. 
              Please note that this action is permanent and cannot be undone.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">5. Contact Information</h2>
            <p>
              If you have any questions or require assistance with the data deletion process, please contact us at:
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
