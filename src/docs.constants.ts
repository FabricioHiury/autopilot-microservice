export const CSS_DOCS = `
  body>div:first-child {
      max-height: calc(100vh) !important;
      overflow-y: hidden !important;
  }

  body>div.scalar-app::before {
      content: url(https://app.autopilot.com.br/images/logo_autopilot.svg);
      display: block;
      background-color: #22252b;
      padding: 25px 30px 15px 30px;
      z-index: 999;
      box-shadow: 0px 4px 8px 0px rgba(0, 0, 0, 0.2);
      max-height: 90px;
      width: 100%;
      position: fixed;
      top: 0;
  }

  h1.section-header {
      font-size: 2.5em !important;
      font-weight: 700 !important;
  }

  h2.section-header {
      font-size: 1.8em !important;
      font-weight: 700 !important;
  }

  h3.section-header {
      font-size: 1.2em !important;
  }

  div.sidebar {
      padding-top: calc(90px + 1rem) !important;
      height: 100vh !important;
  }

  div.references-rendered {
      height: 100vh !important;
      overflow-y: auto !important;
  }

  div.section-container:nth-of-type(2) {
      padding-top: 60px !important;
      background-color: rgba(118, 119, 120, 0.05) !important;
  }

  div.section-content {
      padding-top: 1rem !important;
  }

  div.request-header {
      font-size: 1.2em !important;
  }
`;
