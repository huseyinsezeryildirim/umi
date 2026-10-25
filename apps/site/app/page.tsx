import { Nav } from "@/components/Nav";
import { Ending, Faq, Footer, Hero, Panel, Pricing, Privacy, Zoom } from "@/components/Story";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Zoom />
        <Panel />
        <Privacy />
        <Pricing />
        <Faq />
        <Ending />
      </main>
      <Footer />
    </>
  );
}
