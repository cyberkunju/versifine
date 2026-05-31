/* eslint-disable @typescript-eslint/no-empty-object-type */
// See https://kit.svelte.dev/docs/types#app for more info on these.

declare global {
  interface GoogleCredentialResponse {
    credential?: string;
    select_by?: string;
  }

  interface GoogleAccountsApi {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'large' | 'medium' | 'small';
          text?: 'signin_with' | 'signup_with' | 'continue_with';
          shape?: 'rectangular' | 'pill' | 'circle' | 'square';
          logo_alignment?: 'left' | 'center';
          width?: number;
        },
      ): void;
    };
  }

  interface Window {
    google?: { accounts?: GoogleAccountsApi };
  }

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
