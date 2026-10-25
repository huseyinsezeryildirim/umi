type P = { className?: string };

export function AppleIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="macOS">
      <path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.7-1.3Z" />
    </svg>
  );
}

export function WindowsIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Windows">
      <path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
    </svg>
  );
}

export function LinuxIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Linux">
      <ellipse cx="12" cy="14" rx="6" ry="7.5" fill="#1f2328" />
      <ellipse cx="12" cy="15.5" rx="3.8" ry="5.2" fill="#fff" />
      <circle cx="12" cy="6.5" r="4.2" fill="#1f2328" />
      <circle cx="10.4" cy="6" r="1.1" fill="#fff" />
      <circle cx="13.6" cy="6" r="1.1" fill="#fff" />
      <circle cx="10.5" cy="6.1" r=".5" fill="#1f2328" />
      <circle cx="13.5" cy="6.1" r=".5" fill="#1f2328" />
      <path d="M10.6 8.2h2.8l-1.4 1.4z" fill="#f5b400" />
      <ellipse cx="8.6" cy="21.2" rx="2.4" ry="1.1" fill="#f5b400" />
      <ellipse cx="15.4" cy="21.2" rx="2.4" ry="1.1" fill="#f5b400" />
    </svg>
  );
}

export function ChromeIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Chrome">
      <circle cx="12" cy="12" r="10" fill="#db4437" />
      <path d="M12 12 3.3 7a10 10 0 0 0 5.4 14.4z" fill="#0f9d58" />
      <path d="M12 12h8.9a10 10 0 0 1-12.2 9.4z" fill="#f4b400" />
      <circle cx="12" cy="12" r="4.6" fill="#fff" />
      <circle cx="12" cy="12" r="3.6" fill="#4285f4" />
    </svg>
  );
}

/** A browser window. */
export function BrowserIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-label="Browser">
      <rect x="2.5" y="4" width="19" height="16" rx="3" />
      <path d="M2.5 9h19" />
      <circle cx="5.8" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="8" cy="6.5" r=".5" fill="currentColor" />
    </svg>
  );
}

/** Loom's mark: a burst of rounded rays around an open centre. */
export function LoomIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Loom">
      <g fill="#625df5">
        {Array.from({ length: 8 }).map((_, i) => (
          <rect key={i} x="10.6" y="1.2" width="2.8" height="7.4" rx="1.4" transform={`rotate(${i * 45} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

/** Cap's mark: a blue ring. */
export function CapIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Cap">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#4785ff" strokeWidth="3.4" />
    </svg>
  );
}
