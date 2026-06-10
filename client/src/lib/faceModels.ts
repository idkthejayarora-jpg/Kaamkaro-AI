/**
 * Shared face-api model loader.
 * - URL is pinned to the installed package version so the browser HTTP cache
 *   reliably serves repeat visits (the unpinned URL redirects per-release).
 * - Module-level promise: models load at most once per session no matter how
 *   many kiosk/enroll/scan views are opened.
 */
import * as faceapi from '@vladmandic/face-api';

export const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';

let modelsPromise: Promise<void> | null = null;

export function loadFaceModels(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => undefined)
      .catch(err => { modelsPromise = null; throw err; }); // allow retry on failure
  }
  return modelsPromise;
}
