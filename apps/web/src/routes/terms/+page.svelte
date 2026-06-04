<script lang="ts">
/**
 * Terms of Service Page
 */
import VMark from '$lib/components/brand/VMark.svelte';
import Wordmark from '$lib/components/brand/Wordmark.svelte';
</script>

<svelte:head>
  <title>Terms of Service · Versifine</title>
  <meta name="description" content="Terms of Service for the Versifine personal finance platform." />
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
          Clear, simple, and honest terms. No hidden traps, no toy disclaimers. Sourced for real platforms.
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
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
        <p class="mt-2 text-sm text-[var(--muted-foreground)]">Effective Date: June 5, 2026</p>
        
        <div class="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700">
          <p>
            Welcome to Versifine! These Terms of Service ("Terms") govern your access to and use of the website, 
            dashboard app, APIs, and WhatsApp message capture services provided by Versifine, Inc. ("Versifine", 
            "we", "us", or "our").
          </p>
          <p>
            By creating an account, linking your WhatsApp number, or using any part of the service, you agree to be bound 
            by these Terms. If you do not agree, please do not access or use the platform.
          </p>

          <hr class="border-[var(--border)]" />

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">1. Description of Service</h2>
            <p>
              Versifine provides a personal finance management tool that aggregates, categorizes, and analyzes 
              your transaction data. Users can log entries through web inputs or directly by sending text messages, 
              voice clips, or photos to our integrated WhatsApp Business Cloud API number.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">2. Account Registration and Security</h2>
            <p>To use our services, you must register for an account. You agree to:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Provide accurate, current, and complete information during registration.</li>
              <li>Maintain the security of your password and active session tokens.</li>
              <li>Promptly notify us if you suspect any unauthorized access or breach of security.</li>
              <li>Take responsibility for all transactions logged and actions taken under your account.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">3. Acceptable Use and Restrictions</h2>
            <p>You agree not to misuse the service. Prohibited activities include, but are not limited to:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Using WhatsApp automation to send spam, bulk messages, or engage in fraudulent activities.</li>
              <li>Attempting to scrape, reverse engineer, or exploit the APIs, categorization structures, or database assets.</li>
              <li>Uploading malicious media files, scripts, or executing prompt injections designed to disrupt the AI parser or RAG engine.</li>
              <li>Accessing or attempting to access other users' multi-tenant workspaces.</li>
            </ul>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">4. Third-Party Platform Dependencies</h2>
            <p class="italic bg-[var(--secondary)] border-l-2 border-[var(--brand)] p-3 text-sm rounded-r-md">
              <strong>Crucial Platform Note:</strong> Versifine relies heavily on third-party integrations, 
              including the Meta/WhatsApp Business Platform, OpenAI API services, and cloud hosting infrastructure. 
              We cannot guarantee 100% service uptime or immediate delivery, as performance is subject to the availability, 
              rules, and latency of these external services. We are not liable for outages caused by platform-level failures 
              originating from Meta or OpenAI.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">5. Content Ownership and Licenses</h2>
            <p>
              You retain all ownership rights to any transaction records, receipt photos, text logs, or voice transcripts 
              you upload or send to the platform. By submitting content, you grant Versifine a limited, non-exclusive, 
              worldwide license to parse, classify, translate, and format this data solely to provide and improve the 
              service for you.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">6. AI Disclaimer (Accuracy of Output)</h2>
            <p>
              Our transaction parser, receipt vision OCR, and copilot insights use artificial intelligence models. 
              While we run multi-tier validations to verify amounts and merchants, we do not guarantee the 
              absolute accuracy of automated categorization, translation, or financial advice. The service is provided 
              for personal informational purposes and should not be treated as professional financial advice.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Versifine, Inc. shall not be liable for any direct, indirect, 
              incidental, special, consequential, or exemplary damages, including but not limited to loss of profits, 
              goodwill, or data, arising from the use of or inability to use the service.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">8. Changes to Terms and Service</h2>
            <p>
              We reserve the right to modify or terminate the service or these Terms at any time. We will provide 
              notice of material changes by posting the updated Terms on this page with a new Effective Date.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">9. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, 
              United States, without regard to conflict of law principles.
            </p>
          </section>

          <section class="space-y-3">
            <h2 class="text-xl font-semibold text-slate-900">10. Contact Us</h2>
            <p>If you have any questions or concerns regarding these Terms, please contact us at:</p>
            <p class="font-medium">
              Email: <a href="mailto:support@versifine.com" class="underline text-[var(--brand)]">support@versifine.com</a>
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
