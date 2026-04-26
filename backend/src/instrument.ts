import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://978c368c05bed519268285c23dbe9006@o106257.ingest.us.sentry.io/4511082691690496",
  tracesSampleRate: 1.0,
});
