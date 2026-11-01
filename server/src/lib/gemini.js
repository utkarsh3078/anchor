import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

// The SDK only retries when retryOptions is set; it then retries 408, 429 and 5xx
// (e.g. 503 "model is experiencing high demand") with exponential backoff.
export const ai = new GoogleGenAI({
  apiKey: config.gemini.apiKey,
  httpOptions: { retryOptions: { attempts: 4, initialDelay: 1, maxDelay: 10 } },
});
