import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { AgentKit, Agents, Ai, Loom, Modes, Platforms } from "@/components/Sections";
import { EditorGrid, NotJust, Storage } from "@/components/Showcase";
import { Ending, Faq, Footer, Privacy } from "@/components/Story";
import { Pricing } from "@/components/Pricing";

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
        <AgentKit />
        <Storage />
        <Pricing />
        {/* Testimonials: hidden until there are real quotes. */}
        <Loom />
        <Faq />
        <Ending />
      </main>
      <Footer />
    </>
  );
}
