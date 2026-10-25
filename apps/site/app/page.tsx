import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Agents, Ai, BeforeAfter, Loom, Modes, Platforms, Tools } from "@/components/Sections";
import { Ending, Faq, Footer, Pricing, Privacy } from "@/components/Story";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <BeforeAfter />
        <Modes />
        <Tools />
        <Ai />
        <Privacy />
        <Platforms />
        <Agents />
        <Pricing />
        <Faq />
        <Loom />
        <Ending />
      </main>
      <Footer />
    </>
  );
}
