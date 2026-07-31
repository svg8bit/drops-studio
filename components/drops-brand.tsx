import Image from "next/image";

type DropsBrandProps = {
  compact?: boolean;
  showPartners?: boolean;
};

export function DropsBrand({
  compact = false,
  showPartners = true,
}: DropsBrandProps) {
  return (
    <div
      className={`drops-brand${compact ? " drops-brand-compact" : ""}`}
      aria-label={showPartners ? "Drops Studio by DropsTab" : "Drops Studio"}
    >
      <span className="drops-brand-marks" aria-hidden="true">
        <span className="drops-brand-dropstab">
          <Image
            src="/brand/dropstab-mark.svg"
            alt=""
            width={24}
            height={32}
            loading="eager"
            style={{ height: compact ? 21 : 25, width: "auto" }}
            unoptimized
          />
        </span>
      </span>
      <span className="drops-brand-copy">
        <strong>
          Drops <span>Studio</span>
        </strong>
      </span>
    </div>
  );
}
