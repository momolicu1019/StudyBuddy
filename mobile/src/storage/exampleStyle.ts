/**
 * Match example style to the material: situational subjects (law, ethics,
 * policy, case studies) get fact-pattern / "If … then …" examples.
 */

const SITUATIONAL_HINT =
  /\b(law|legal|statute|statutes|legislation|legislat|constitution|constitutional|criminal|civil|tort|torts|contract|contracts|property|evidence|procedure|jurisprudence|case\s*law|court|courts|litigation|rights|ethics|ethical|policy|policies|regulation|regulations|compliance|governance|negotiation|mediation|arbitration|criminology|forensic|business\s*law|family\s*law|labor\s*law|labour\s*law|tax\s*law|admin(?:istrative)?\s*law)\b/i;

export function isSituationalMaterial(hints: Array<string | undefined | null>): boolean {
  const blob = hints.filter(Boolean).join(' ');
  return SITUATIONAL_HINT.test(blob);
}

/** Prompt rules for how the Example bullet should be written. */
export function exampleStyleInstruction(args: {
  filename?: string;
  sourceLabel?: string;
  subject?: string;
  situational?: boolean;
}): string {
  const situational =
    args.situational ??
    isSituationalMaterial([args.filename, args.sourceLabel, args.subject]);

  if (situational) {
    return [
      'Example style for this material (situational / law-style):',
      'ALWAYS include one bullet starting with "Example: " written as a short fact pattern or scenario.',
      'Prefer “If/When [situation], then [legal or practical consequence] …” or a mini case with parties (A rents to B…, Officer stops a driver…).',
      'Ground the scenario in doctrines, elements, duties, rights, defenses, or procedures from the source — not generic science metaphors.',
      'Keep the scenario to 1–2 sentences; include the outcome or how the rule applies.',
      'Good: "Example: If a landlord enters a rented apartment without notice, the tenant may claim breach of quiet enjoyment."',
      'Bad: "Example: Plants release oxygen in sunlight." (wrong domain)',
    ].join(' ');
  }

  return [
    'Example style: match the domain of the material.',
    'ALWAYS include one bullet starting with "Example: ".',
    'For science/math: use a concrete case, formula application, or mini worked problem.',
    'For history/social studies: use a brief dated event or actor illustration.',
    'For situational subjects (law, ethics, policy, regulations, case studies): use a short If/When fact pattern showing how the rule applies to parties.',
    'Never force a science-style example onto law/policy content.',
  ].join(' ');
}

/** JSON field hint for the example property. */
export function exampleFieldHint(situational: boolean): string {
  return situational
    ? '"example": "short If/When fact pattern applying the rule to parties or a concrete case"'
    : '"example": "one concrete case, mini problem, scenario, or real-world application matched to the subject"';
}
