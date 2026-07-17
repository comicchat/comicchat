// Command registry — the web equivalent of the original's command routing.
// IDs, labels, prompts and tooltips follow chat.rc verbatim.

export interface Command {
  id: string;
  run?: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** Status-bar prompt (first half of the rc string). */
  prompt?: string;
  /** Tooltip (second half of the rc string). */
  tip?: string;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  onAfterRun: () => void = () => {};

  register(cmd: Command) {
    this.commands.set(cmd.id, cmd);
  }

  registerAll(cmds: Command[]) {
    for (const c of cmds) this.register(c);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  isEnabled(id: string): boolean {
    const c = this.commands.get(id);
    if (!c || !c.run) return false;
    return c.enabled ? c.enabled() : true;
  }

  isChecked(id: string): boolean {
    const c = this.commands.get(id);
    return c?.checked ? c.checked() : false;
  }

  run(id: string): boolean {
    const c = this.commands.get(id);
    if (!c?.run || !this.isEnabled(id)) return false;
    c.run();
    this.onAfterRun();
    return true;
  }

  prompt(id: string): string {
    return this.commands.get(id)?.prompt ?? '';
  }

  tip(id: string): string {
    return this.commands.get(id)?.tip ?? '';
  }
}
