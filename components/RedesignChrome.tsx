import Image from "next/image";
import type { KidsTrialCalendarPreviewScope } from "@/config/kids-trial-readiness";

interface Props {
  previewScope?: KidsTrialCalendarPreviewScope | null;
}

export default function RedesignChrome({ previewScope }: Props) {
  const kidsSchedule = previewScope === "kids_schedule";

  return (
    <>
      <div className="trial-announcement">
        {kidsSchedule
          ? "Kids tennis schedules · Ask our team about trials"
          : previewScope === "trial_program"
            ? "Kids trial calendar · Booking by request"
            : "Free kids trial · Racquet provided · No credit card"}
      </div>
      <header className="trial-site-header">
        <div className="trial-site-header__inner">
          <a href="https://www.court16.com" className="trial-brand" aria-label="Court 16 home">
            <Image
              src="/redesign/assets/court16-logo.png"
              alt="Court 16 — Tennis Remixed"
              width={204}
              height={96}
              priority
            />
          </a>
          <nav className="trial-nav" aria-label="Trial help">
            <span className="trial-nav__label">
              {kidsSchedule ? "Kids class calendar" : previewScope ? "Trial calendar" : "Book kids trial"}
            </span>
            <a className="trial-nav__phone" href="tel:+17188755550">
              Questions? 718-875-5550
            </a>
            <a className="trial-nav__site" href="https://www.court16.com">
              Court16.com <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}
