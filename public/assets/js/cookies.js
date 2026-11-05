window.addEventListener("load", function(){
  window.cookieconsent.initialise({
    palette: {
      popup: { background: "#000" },
      button: { background: "#f1d600" }
    },
    theme: "classic",
    type: "opt-in", // Nutzer kann zustimmen oder ablehnen
    content: {
      message: "Diese Website verwendet Cookies.",
      dismiss: "Ablehnen",
      allow: "Akzeptieren",
      link: "Mehr erfahren",
      href: "/privacy"
    }
  })
});