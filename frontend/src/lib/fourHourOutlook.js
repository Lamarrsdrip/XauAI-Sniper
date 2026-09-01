// XauCloud 4H Outlook — client data layer (READ-ONLY + mark-seen).
// Talks only to the backend 4H Outlook endpoints. No trade actions exist here.
import axios from "axios";
import { API } from "@/lib/api";

const client = axios.create({ baseURL: API, withCredentials: true });

export async function fetch4HOutlook() {
  const { data } = await client.get("/cloud/4h-outlook/current");
  return data; // { available, outlook } | { available:false, reason }
}

export async function fetch4HHistory(limit = 30) {
  const { data } = await client.get(`/cloud/4h-outlook/history?limit=${limit}`);
  return data?.history || [];
}

export async function mark4HSeen() {
  try {
    await client.post("/cloud/4h-outlook/seen");
  } catch {
    /* non-critical */
  }
}
