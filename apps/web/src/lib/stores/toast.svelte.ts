/**
 * Lightweight toast queue.
 *
 * One singleton; the layout renders `<Toaster />` once, every component
 * pushes via `toast.info(...)`. Toasts auto-dismiss after `duration` ms,
 * dismissible manually as well.
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
}

class ToastStore {
  items = $state<ToastItem[]>([]);
  private nextId = 1;

  push(item: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }): number {
    const id = this.nextId++;
    const next: ToastItem = {
      id,
      variant: item.variant,
      title: item.title,
      duration: item.duration ?? 4000,
      ...(item.description !== undefined ? { description: item.description } : {}),
    };
    this.items = [...this.items, next];
    if (next.duration > 0) {
      setTimeout(() => this.dismiss(id), next.duration);
    }
    return id;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  info(title: string, description?: string): number {
    return this.push({ variant: 'info', title, ...(description ? { description } : {}) });
  }
  success(title: string, description?: string): number {
    return this.push({ variant: 'success', title, ...(description ? { description } : {}) });
  }
  warning(title: string, description?: string): number {
    return this.push({ variant: 'warning', title, ...(description ? { description } : {}) });
  }
  error(title: string, description?: string): number {
    return this.push({ variant: 'error', title, ...(description ? { description } : {}) });
  }
}

export const toast = new ToastStore();
