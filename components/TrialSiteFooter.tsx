export default function TrialSiteFooter() {
  return (
    <footer className="trial-site-footer">
      <div className="trial-site-footer__inner">
        <div>
          <div className="trial-site-footer__brand">Court 16</div>
          <p>Tennis remixed for the whole family.</p>
        </div>
        <nav className="trial-site-footer__links" aria-label="Court 16 information">
          <a href="https://www.court16.com/kids-tennis-academy">Kids Academy</a>
          <a href="https://www.court16.com/contact">Contact</a>
          <a href="https://www.court16.com/terms/privacy-policy">Privacy</a>
          <a href="https://www.court16.com/terms/terms-of-use">Terms</a>
        </nav>
        <div className="trial-site-footer__contact">
          <a href="tel:+17188755550">718-875-5550</a>
          <span>© 2026 Court 16, Inc.</span>
        </div>
      </div>
    </footer>
  );
}
