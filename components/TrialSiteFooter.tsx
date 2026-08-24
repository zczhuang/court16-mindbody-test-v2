/**
 * Replica of the court16.com footer (structure captured from the live site,
 * July 18 2026): Babolat + USTA partner logos, the three yellow link
 * columns, the Contact block, circular social icons, the Court 16 Gazette
 * pill, and the centered copyright under a hairline rule. Links point at
 * court16.com since this app lives on its own domain.
 */
export default function TrialSiteFooter() {
  return (
    <footer className="trial-site-footer">
      <div className="trial-site-footer__inner">
        <div className="trial-site-footer__partners">
          <img src="/assets/footer/babolat.png" alt="Powered by Babolat" />
          <img src="/assets/footer/usta.png" alt="USTA" />
        </div>
        <nav className="trial-site-footer__links" aria-label="Court 16 information">
          <ul>
            <li><a href="https://www.court16.com/get-updates">Join Mailing List</a></li>
            <li><a href="https://www.court16.com/careers">Careers</a></li>
            <li><a href="https://www.court16.com/about/press">Press</a></li>
          </ul>
          <ul>
            <li><a href="https://www.court16.com/about/our-tennis-mission">Our Mission</a></li>
            <li><a href="https://www.court16.com/faq">FAQ</a></li>
            <li><a href="https://www.court16.com/terms/terms-of-use">Terms of Use</a></li>
            <li><a href="https://www.court16.com/terms/membership-terms">Membership Terms</a></li>
          </ul>
          <ul>
            <li><a href="https://www.court16.com/terms/club-policies">Club Policies</a></li>
            <li><a href="https://www.court16.com/terms/liability-waiver">Liability Waiver</a></li>
            <li><a href="https://www.court16.com/terms/privacy-policy">Privacy Policy</a></li>
          </ul>
        </nav>
        <div className="trial-site-footer__contact">
          <h4>Contact</h4>
          <a className="trial-site-footer__contact-link" href="https://www.court16.com/contact">
            Contact Us!
          </a>
          <a className="trial-site-footer__phone" href="tel:+17188755550">
            718-875-5550
          </a>
        </div>
        <div className="trial-site-footer__social">
          <div className="trial-site-footer__icons">
            <a
              href="https://www.facebook.com/Court16tennis/"
              aria-label="Court 16 on Facebook"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M13.4 21v-8.2h2.76l.41-3.2H13.4V7.56c0-.93.26-1.56 1.59-1.56h1.7V3.14c-.3-.04-1.3-.13-2.48-.13-2.45 0-4.13 1.5-4.13 4.24v2.36H7.31v3.2h2.77V21h3.32Z" />
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/company/court16"
              aria-label="Court 16 on LinkedIn"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.94 8.94H3.6V20.4h3.34V8.94ZM5.27 3.6a1.94 1.94 0 1 0 0 3.88 1.94 1.94 0 0 0 0-3.88ZM20.4 13.36c0-3.1-1.66-4.55-3.87-4.55-1.79 0-2.59.98-3.04 1.67V8.94H10.2c.04.94 0 11.46 0 11.46h3.29v-6.4c0-.34.02-.68.12-.93.28-.68.9-1.39 1.94-1.39 1.37 0 1.92 1.04 1.92 2.57v6.15h3.28l.05-7.04Z" />
              </svg>
            </a>
            <a
              href="https://instagram.com/court16tennis"
              aria-label="Court 16 on Instagram"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 4.9c2.31 0 2.59.01 3.5.05.85.04 1.31.18 1.61.3.4.16.69.35 1 .65.3.31.49.6.65 1 .12.3.26.76.3 1.61.04.91.05 1.19.05 3.5s-.01 2.58-.05 3.49c-.04.85-.18 1.31-.3 1.61-.16.4-.35.69-.65 1-.31.3-.6.49-1 .65-.3.12-.76.26-1.61.3-.91.04-1.19.05-3.5.05s-2.59-.01-3.5-.05c-.85-.04-1.31-.18-1.61-.3a2.7 2.7 0 0 1-1-.65 2.7 2.7 0 0 1-.65-1c-.12-.3-.26-.76-.3-1.61-.04-.91-.05-1.18-.05-3.49s.01-2.59.05-3.5c.04-.85.18-1.31.3-1.61.16-.4.35-.69.65-1 .31-.3.6-.49 1-.65.3-.12.76-.26 1.61-.3.91-.04 1.19-.05 3.5-.05Zm0-1.9c-2.35 0-2.65.01-3.57.05-.93.04-1.56.19-2.11.4a4.27 4.27 0 0 0-1.54 1 4.27 4.27 0 0 0-1 1.54c-.21.55-.36 1.18-.4 2.1-.04.93-.05 1.23-.05 3.58s.01 2.65.05 3.57c.04.93.19 1.56.4 2.11.22.57.51 1.05 1 1.54.49.49.97.78 1.54 1 .55.21 1.18.36 2.11.4.92.04 1.22.05 3.57.05s2.65-.01 3.57-.05c.93-.04 1.56-.19 2.11-.4a4.27 4.27 0 0 0 1.54-1c.49-.49.78-.97 1-1.54.21-.55.36-1.18.4-2.11.04-.92.05-1.22.05-3.57s-.01-2.65-.05-3.58c-.04-.92-.19-1.55-.4-2.1a4.27 4.27 0 0 0-1-1.54 4.27 4.27 0 0 0-1.54-1c-.55-.21-1.18-.36-2.11-.4C14.65 3.01 14.35 3 12 3Zm0 4.32a4.68 4.68 0 1 0 0 9.36 4.68 4.68 0 0 0 0-9.36Zm0 7.72a3.04 3.04 0 1 1 0-6.08 3.04 3.04 0 0 1 0 6.08Zm5.96-7.9a1.09 1.09 0 1 1-2.18 0 1.09 1.09 0 0 1 2.18 0Z" />
              </svg>
            </a>
          </div>
          <a className="trial-site-footer__gazette" href="https://www.court16.com/blog">
            Court 16 Gazette
          </a>
        </div>
      </div>
      <div className="trial-site-footer__legal">
        <p>© 2026 Court 16, Inc. All rights reserved.</p>
      </div>
    </footer>
  );
}
