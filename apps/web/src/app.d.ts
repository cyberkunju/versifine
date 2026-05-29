/* eslint-disable @typescript-eslint/no-empty-object-type */
// See https://kit.svelte.dev/docs/types#app for more info on these.

declare global {
  namespace App {
    interface Error {
      code?: string;
      message: string;
    }
    interface Locals {}
    interface PageData {
      user?: import('@versifine/shared').UserSummary | null;
    }
    interface PageState {}
    interface Platform {}
  }
}

export {};
