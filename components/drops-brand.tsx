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
      aria-label="Drops Studio by DropsTab and Drops Bot"
    >
      <span className="drops-brand-marks" aria-hidden="true">
        <span className="drops-brand-dropstab">
          <Image
            src="/brand/dropstab-mark.svg"
            alt=""
            width={24}
            height={32}
            loading="eager"
            unoptimized
          />
        </span>
        <Image
          className="drops-brand-bot"
          src="/brand/drops-bot-avatar.jpg"
          alt=""
          width={32}
          height={32}
          loading="eager"
          sizes="32px"
        />
      </span>
      <span className="drops-brand-copy">
        <strong>Drops Studio</strong>
        {showPartners ? (
          <span className="drops-brand-partners">
            <span>
              <Image
                src="/brand/dropstab-mark.svg"
                alt=""
                width={11}
                height={14}
                unoptimized
              />
              DropsTab
            </span>
            <i aria-hidden="true">×</i>
            <span>
              <Image
                src="/brand/drops-bot-avatar.jpg"
                alt=""
                width={14}
                height={14}
                sizes="14px"
              />
              Drops Bot
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
