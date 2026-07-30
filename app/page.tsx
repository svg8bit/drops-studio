import { DropsStudio } from "@/components/drops-studio";
import { Sparkles } from "lucide-react";

function LandingHero() {
  return (
    <div className="hero-copy">
      <span className="eyebrow">
        <Sparkles size={14} /> BUILD IN 5 MINUTES
      </span>
      <h1>
        Turn a crypto idea{" "}
        <br className="hero-break" />
        into a live project<span>.</span>
      </h1>
      <div className="hero-description">
        <p>
          Start from 12 extensible working foundations or describe any crypto
          product.
        </p>
        <p>
          Drops Studio assembles the data, triggers, AI brain and output around
          DropsTab + Drops Bot.
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return <DropsStudio hero={<LandingHero />} />;
}
