<script lang="ts">
import { Tabs as T } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils/cn';

type Props = { value: string; class?: string; children?: Snippet };
let { class: className, children, value }: Props = $props();
</script>

<T.Content {value} class={cn('mt-2 focus-visible:outline-none', className)}>
  {@render children?.()}
</T.Content>
