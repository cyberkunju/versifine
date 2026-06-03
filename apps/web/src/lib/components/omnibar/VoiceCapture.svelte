<script lang="ts">
/**
 * Microphone capture using MediaRecorder. While recording, we draw a
 * lightweight bar visualisation from the analyser node. On stop the
 * collected blob is handed back via `onComplete`.
 */
import { onDestroy } from 'svelte';
import { Mic, Square } from 'lucide-svelte';

type Props = {
  onComplete: (blob: Blob) => void;
  onError?: (message: string) => void;
};
let { onComplete, onError }: Props = $props();

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: BlobPart[] = [];
let isRecording = $state(false);
let level = $state(0);
let raf: number | null = null;

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    onError?.(err instanceof Error ? err.message : 'Microphone unavailable');
    return;
  }
  chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    cleanup();
    onComplete(blob);
  };
  recorder.start();
  isRecording = true;
  pumpAnalyser();
}

function pumpAnalyser() {
  if (!stream) return;
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    level = sum / data.length / 255;
    raf = requestAnimationFrame(tick);
  };
  tick();
}

function stop() {
  if (recorder && isRecording) {
    recorder.stop();
    isRecording = false;
  }
}

function cleanup() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  recorder = null;
}

onDestroy(cleanup);
</script>

<div class="flex flex-col items-center gap-3 py-4">
  <button
    type="button"
    class="grid h-16 w-16 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
    style:transform={`scale(${1 + level * 0.4})`}
    onclick={isRecording ? stop : start}
    aria-label={isRecording ? 'Stop recording' : 'Start recording'}
  >
    {#if isRecording}
      <Square class="h-6 w-6" />
    {:else}
      <Mic class="h-6 w-6" />
    {/if}
  </button>
  <p class="text-xs text-[hsl(var(--muted-foreground))]">
    {isRecording ? 'Listening — tap to stop' : 'Tap to start recording'}
  </p>
</div>
