// Registers the service worker so the site keeps working with no network.
// Kept out of the page shell so the SW can precache it like any other asset.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    var base = new URL(".", document.baseURI);
    var root = document.querySelector('link[rel="manifest"]').getAttribute("href")
      .replace("manifest.webmanifest", "");
    navigator.serviceWorker.register(new URL(root + "sw.js", base).pathname,
      { scope: new URL(root, base).pathname })
      .catch(function () { /* offline support is a bonus, never a blocker */ });
  });
}
