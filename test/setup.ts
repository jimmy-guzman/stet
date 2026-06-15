// Tests never auto-download a language server (no network, no slow installs). The provisioner's own
// Tests toggle this explicitly and restore it.
process.env.SIDEYE_NO_LSP_DOWNLOAD = "1";
