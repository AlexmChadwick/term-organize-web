// Pure (no node:fs) so both banner.ts and catalog-store.ts can import it.

const WORK_DOMAINS = new Set(["northeastern.edu", "neu.edu"]);

/**
 * Whole address, exact domain. The domain must be ASCII and equal one of the two
 * allowed names after ASCII case folding, so subdomains (husky.neu.edu), trailing
 * dots, non-ASCII and lookalike domains do not match. The local part is kept whole.
 */
function isWorkEmail(candidate: string): boolean {
  const at = candidate.lastIndexOf("@");
  if (at < 1 || candidate.indexOf("@") !== at) return false;
  const domain = candidate.slice(at + 1);
  if (!/^[\x21-\x7e]+$/.test(domain)) return false;
  return WORK_DOMAINS.has(domain.toLowerCase());
}

/**
 * Banner sometimes stores several addresses in one instructor field. Keep only
 * addresses whose domain is exactly northeastern.edu or neu.edu.
 * An omitted email stays omitted: this never fills one in.
 */
export function publishedInstructorEmail(email: string): string | undefined {
  const kept = email.split(/[\s,;<>]+/).filter(isWorkEmail);
  return kept.length > 0 ? kept.join(" ") : undefined;
}
