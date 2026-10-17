// Vercel function: the whole SAAHI API. vercel.json rewrites /api/* here.
import { handle } from "../server/app";

export default {
  fetch: handle,
};
