export default function RedesignChrome() {
  return (
    <header className="trial-site-header">
      <div className="trial-site-header__inner">
        <a href="https://www.court16.com" className="trial-brand" aria-label="Court 16 home">
          <img
            src="/redesign/assets/court16-logo.png"
            alt="Court 16 — Tennis Remixed"
          />
        </a>
        <div className="trial-nav" aria-label="Trial help">
          <span className="trial-nav__label">Kids trial</span>
          <a className="trial-nav__phone" href="tel:+17188755550">
            Questions? 718-875-5550
          </a>
          <a className="trial-nav__site" href="https://www.court16.com">
            Court16.com <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </header>
  );
}
