"use strict";
/* Setup values. Empty until the owner registers a GitHub App and a CORS relay (see README in this folder). */
window.UNGGAH_CONFIG = {
  API: "https://api.github.com",
  CLIENT_ID: "",   /* public client id of the owner's GitHub App (device flow enabled) */
  RELAY: "",       /* https URL of a stateless relay for the two github.com device-flow endpoints */
  REAL_WRITES: false /* stays false until a real test repo is approved; loopback test servers are always allowed */
};
