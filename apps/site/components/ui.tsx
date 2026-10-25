/** The logo: two rings of dots, in the current text color. */
export function Mark({ className = "size-7" }: { className?: string }) {
  return <span aria-hidden className={`mark ${className}`} />;
}
