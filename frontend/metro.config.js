const {getDefaultConfig} = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// jspdf uses a dynamic require for html2canvas that breaks Metro's static analysis.
// Block it from being resolved since we don't use PDF generation on web.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "jspdf" || moduleName === "html2canvas") {
    return {type: "empty"};
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
