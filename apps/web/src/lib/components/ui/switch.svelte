<script lang="ts">
  import { Switch as S } from 'bits-ui';
  import { cn } from '$lib/utils/cn';

  type Props = {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    class?: string;
    id?: string;
    'aria-label'?: string;
  };

  let {
    checked = $bindable(),
    onCheckedChange,
    disabled,
    class: className,
    id,
    ...rest
  }: Props = $props();
</script>

<S.Root
  bind:checked
  onCheckedChange={(v) => onCheckedChange?.(v)}
  {disabled}
  {id}
  class={cn(
    'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:bg-[hsl(var(--primary))] data-[state=unchecked]:bg-[hsl(var(--muted))]',
    className,
  )}
  {...rest}
>
  <S.Thumb
    class={cn(
      'pointer-events-none block h-4 w-4 rounded-full bg-[hsl(var(--background))] shadow-lg ring-0 transition-transform',
      'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
    )}
  />
</S.Root>
