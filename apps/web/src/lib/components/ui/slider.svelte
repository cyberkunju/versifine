<script lang="ts">
import { Slider as S } from 'bits-ui';
import { cn } from '$lib/utils/cn';

type Props = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  class?: string;
  disabled?: boolean;
};

let {
  value = $bindable(),
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  class: className,
  disabled,
}: Props = $props();

let arr = $state([value]);
$effect(() => {
  arr = [value];
});
</script>

<S.Root
  type="single"
  bind:value
  {min}
  {max}
  {step}
  {disabled}
  onValueChange={(v) => {
    if (typeof v === 'number') onValueChange?.(v);
  }}
  class={cn('relative flex w-full touch-none select-none items-center', className)}
>
  <span class="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[hsl(var(--muted))]">
    <S.Range class="absolute h-full bg-[hsl(var(--primary))]" />
  </span>
  <S.Thumb
    index={0}
    class="block h-4 w-4 rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(var(--background))] shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
  />
</S.Root>
