import Link from "next/link";
import { Mark } from "./ui";

/** A legal page: plain, readable prose with numbered sections. */
export function LegalPage(props: { title: string; updated: string; intro: React.ReactNode; sections: [string, React.ReactNode][] }) {
  return (
    <div className="min-h-screen px-5 pb-24">
      <header className="mx-auto flex max-w-3xl items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
          <Mark className="size-6" /> Umi
        </Link>
        <nav className="flex gap-5 text-sm text-muted">
          <Link href="/terms" className="hover:text-text">Terms</Link>
          <Link href="/copyright" className="hover:text-text">Copyright</Link>
        </nav>
      </header>
      <article className="legal mx-auto max-w-3xl pt-10">
        <h1 className="h-display text-[clamp(32px,5vw,48px)]">{props.title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated {props.updated}</p>
        <div className="mt-8 text-[17px] leading-relaxed">{props.intro}</div>
        <ol className="mt-10 grid gap-10">
          {props.sections.map(([heading, body], i) => (
            <li key={heading} id={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>
              <h2 className="text-xl font-semibold tracking-tight">
                {i + 1}. {heading}
              </h2>
              <div className="mt-3 grid gap-3 text-[15.5px] leading-relaxed text-text">{body}</div>
            </li>
          ))}
        </ol>
      </article>
    </div>
  );
}
