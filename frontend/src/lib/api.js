const configuredBackend = process.env.REACT_APP_BACKEND_URL;

export const BACKEND_URL =
  configuredBackend && configuredBackend !== "undefined"
    ? configuredBackend.replace(/\/$/, "")
    : window.location.origin;

export const API = `${BACKEND_URL}/api`;
