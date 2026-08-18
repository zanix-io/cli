/**
 * Options for {@linkcode baseArgumentActionCommand} (`utils/commands.ts`) — declares a command's
 * positional arguments. `requiredArgs` is always emitted BEFORE `optionalArgs` in the generated
 * argument string, matching the standard positional-argument convention (a required argument
 * cannot follow an optional one) — the relative order of `requiredArgs`/`optionalArgs` here has no
 * bearing on that; only which array an argument name is placed in matters.
 */
export type ArgumentCommandOptions = {
  name: string
  description: string
  optionalArgs?: string[]
  requiredArgs?: string[]
  // deno-lint-ignore no-explicit-any
  action: (...data: any[]) => void | Promise<void>
}
