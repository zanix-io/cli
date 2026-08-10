export type ArgumentCommandOptions = {
  name: string
  description: string
  optionalArgs?: string[]
  requiredArgs?: string[]
  // deno-lint-ignore no-explicit-any
  action: (...data: any[]) => void | Promise<void>
}
