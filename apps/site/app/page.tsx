import { Download } from "@/components/Download";
import { Cloud, Features, Stats } from "@/components/Features";
import { Hero, Ticker } from "@/components/Hero";
import { Modes } from "@/components/Modes";
import { Nav } from "@/components/Nav";
import { Compare, Faq, Footer, Pricing } from "@/components/Sections";

export default function Home() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Ticker />
        <Modes />
        <Features />
        <Stats />
        <Cloud />
        <Compare />
        <Pricing />
        <Faq />
        <Download />
      </main>
      <Footer />
    </>
  );
}
