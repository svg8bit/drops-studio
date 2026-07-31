import { DropsStudio } from "@/components/drops-studio";
import { Sparkles } from "lucide-react";

function LandingHero() {
  return (
    <div className="hero-copy">
      <span className="eyebrow">
        <Sparkles size={14} /> DROPS AI CRYPTO BUILDER
      </span>
      <h1>
        Build crypto apps{" "}
        <br className="hero-break" />
        10x faster with AI<span>.</span>
      </h1>
      <div className="hero-description">
        <p>
          Describe a product or start from 12 extensible working foundations
          for category-native crypto apps. Review the plan, then build an editable
          multi-file application.
        </p>
        <p>
          DropsTab supplies market intelligence. Drops Bot supplies monitoring,
          alerts and approved Telegram delivery. You own the source.
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return <DropsStudio hero={<LandingHero />} />;
}
