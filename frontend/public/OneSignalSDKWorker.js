/*
 * Compatibility URL for browsers/OneSignal registrations created before the
 * canonical /service-worker.js authority was introduced. It must remain a
 * real JavaScript asset at the site root and must never fall through to the
 * React index.html page.
 */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
