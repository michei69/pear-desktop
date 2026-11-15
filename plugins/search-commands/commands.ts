/**
 * The `/`-prefixed commands the search box understands.
 */

export interface CommandArg {
  /** Rendered as `<name>` until the argument is typed. */
  name: string;
  /** Rendered as `[name]` instead, hinting that it can be left out. */
  optional?: boolean;
}

export interface CommandRow {
  /** The command line as it would be written into the search box. */
  text: string;
  /** Command name, without the leading slash. */
  name: string;
  /** One entry per declared argument: the typed word, or its placeholder. */
  args: string[];
  description: string;
  command: Command;
}

export interface CommandContext {
  /** Writes `text` into the search box, leaving the palette open for editing. */
  insert(text: string): void;
}

export interface Command {
  /** Without the leading slash. */
  name: string;
  description: string;
  args?: CommandArg[];
  /** Runs on Enter when no autocomplete row is selected. */
  run(args: string[], ctx: CommandContext): void | Promise<void>;
  /**
   * What picking an autocomplete row does: click, or Enter on a selected row.
   * Defaults to writing the row's text into the search box.
   */
  onSelect?(row: CommandRow, ctx: CommandContext): void | Promise<void>;
}

const registry = new Map<string, Command>();

/** Returns an unregister function. */
export const registerCommand = (command: Command): (() => void) => {
  registry.set(command.name, command);
  return () => {
    if (registry.get(command.name) === command) registry.delete(command.name);
  };
};

export const getCommand = (name: string): Command | undefined => registry.get(name);

/** Everything after the slash, split on whitespace. `/` alone yields `['']`. */
export const tokenize = (value: string): string[] => value.slice(1).split(/\s+/);

/** Is this a command line rather than a search? Only a leading slash says so. */
export const isCommandLine = (value: string) => value.startsWith("/");

const renderArg = (arg: CommandArg, typed: string | undefined): string => typed || (arg.optional ? `[${arg.name}]` : `<${arg.name}>`);

const toRow = (command: Command, typed: string[]): CommandRow => {
  const args = (command.args ?? []).map((arg, index) => renderArg(arg, typed[index]));
  return {
    text: `/${[command.name, ...args].join(" ")}`,
    name: command.name,
    args,
    description: command.description,
    command,
  };
};

/**
 * Autocomplete rows for the current search-box value: `/` lists every command,
 * `/pl` every command starting with `pl`, and typed arguments narrow to that
 * command's own row.
 */
export const matchCommands = (value: string, commands: Command[] = [...registry.values()]): CommandRow[] => {
  const [name = "", ...typed] = tokenize(value);

  // Once arguments are being typed the only sensible target is that command.
  if (typed.length > 0) {
    const exact = commands.find((command) => command.name === name);
    return exact ? [toRow(exact, typed)] : [];
  }

  return commands
    .filter((command) => command.name.startsWith(name))
    .sort((a, b) => Number(b.name === name) - Number(a.name === name) || a.name.localeCompare(b.name))
    .map((command) => toRow(command, []));
};
