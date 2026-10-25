import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Agents, Ai, Loom, Modes, Platforms } from "@/components/Sections";
import { EditorGrid, NotJust } from "@/components/Showcase";
import { Ending, Faq, Footer, Pricing, Privacy } from "@/components/Story";

// Sections with a coloured background never sit next to each other.
export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Modes />
        <NotJust />
        <EditorGrid />
        <Ai />
        <Platforms />
        <Privacy />
        <Agents />
        <Pricing />
        <Loom />
        <Faq />
        <Ending />
      </main>
      <Footer />
    </>
  );
}
