/**
 * SLIDE ARTIFACT ONLY — not a real payload.
 *
 * In a real incident, this slot is often a large obfuscated file
 * (control-flow flattening + Base91 / similar encoding), hundreds of KB,
 * executed by a runtime fetched during preinstall.
 *
 * This stub must never contain encoded malware or download logic.
 */
console.log(
  "[LAB STUB] If a malicious loader reached this stage, arbitrary code would run as your user.",
);
