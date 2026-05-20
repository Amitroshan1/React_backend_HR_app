import "./AppFooter.css";

const COPYRIGHT_TEXT =
  "Copyright © 2026 Saffo Solution Technology. All rights reserved.";

export const AppFooter = () => (
  <footer className="app-footer" role="contentinfo">
    <p className="app-footer__text">{COPYRIGHT_TEXT}</p>
  </footer>
);

export default AppFooter;
