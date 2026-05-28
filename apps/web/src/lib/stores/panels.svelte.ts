/**
 * Imperative shell controls.
 *
 * Avoids prop-drilling the copilot/command openers through every page.
 * Pages call `panels.openCopilot('seed text')`; the layout reads the
 * `signal` and reacts via an `$effect`.
 */

class Panels {
  copilotOpen = $state(false);
  copilotSeed = $state<string | null>(null);
  commandOpen = $state(false);

  openCopilot(seed: string | null = null): void {
    this.copilotSeed = seed;
    this.copilotOpen = true;
  }

  setCopilotOpen(open: boolean): void {
    this.copilotOpen = open;
    if (!open) this.copilotSeed = null;
  }

  toggleCommand(): void {
    this.commandOpen = !this.commandOpen;
  }

  setCommandOpen(open: boolean): void {
    this.commandOpen = open;
  }
}

export const panels = new Panels();
