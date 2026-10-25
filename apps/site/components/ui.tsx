// The mark: sound bars around a record light. Bars take the text color, the light is Umi blue.
// This is the 11-bar cut for interface sizes; the 15-bar original (public/umi-mark.svg) is for large uses.
const OUTER = `<rect x="-48.10" y="-10.12" width="4.2" height="20.24" rx="2.1"/><rect x="-38.90" y="-27.60" width="4.2" height="55.20" rx="2.1"/><rect x="-29.70" y="-36.80" width="4.2" height="73.60" rx="2.1"/><rect x="-20.50" y="-42.16" width="4.2" height="84.32" rx="2.1"/><rect x="-11.30" y="-45.07" width="4.2" height="90.14" rx="2.1"/><rect x="-2.10" y="-46.00" width="4.2" height="92.00" rx="2.1"/><rect x="7.10" y="-45.07" width="4.2" height="90.14" rx="2.1"/><rect x="16.30" y="-42.16" width="4.2" height="84.32" rx="2.1"/><rect x="25.50" y="-36.80" width="4.2" height="73.60" rx="2.1"/><rect x="34.70" y="-27.60" width="4.2" height="55.20" rx="2.1"/><rect x="43.90" y="-10.12" width="4.2" height="20.24" rx="2.1"/>`;
const INNER = `<rect x="-23.09" y="-19.76" width="9.38" height="39.52" rx="2.00"/><rect x="-13.89" y="-25.38" width="9.38" height="50.77" rx="2.00"/><rect x="-4.69" y="-27.00" width="9.38" height="54.00" rx="2.00"/><rect x="4.51" y="-25.38" width="9.38" height="50.77" rx="2.00"/><rect x="13.71" y="-19.76" width="9.38" height="39.52" rx="2.00"/>`;

/** The logo, in the current text color with a blue centre (`mono`: all one color). */
export function Mark({ className = "size-7", mono = false }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden className={className}>
      <g fill="currentColor" dangerouslySetInnerHTML={{ __html: OUTER }} />
      <g fill={mono ? "currentColor" : "#116ff5"} dangerouslySetInnerHTML={{ __html: INNER }} />
    </svg>
  );
}
