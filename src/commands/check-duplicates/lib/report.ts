import type { DuplicateFinding } from 'commands/check-duplicates/lib/analyze.ts'

/**
 * Formats a real report, human-readable and CI-log-friendly — the same shape whether a human runs
 * this command directly or an automated CI job invokes it.
 */
export function formatReport(root: string, findings: DuplicateFinding[]): string {
  if (findings.length === 0) {
    return `${root}: current (deno.lock resolves exactly one version per '@zanix/*' package)`
  }

  const lines = findings.map((finding) => {
    const versions = finding.versions
      .map(({ version, specifiers }) => `'${version}' (via ${specifiers.join(', ')})`)
      .join(' and ')

    return `${finding.name}: resolves to ${finding.versions.length} distinct versions at once — ${versions}`
  })

  return lines.join('\n')
}
