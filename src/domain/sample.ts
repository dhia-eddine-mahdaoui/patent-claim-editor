import { createClaim, parseClaimBlock } from './parser';
import type { ClaimDocument } from './types';

/** A fictional invention written for this demo. It contains a few deliberate issues so the checks have something to show. */
export const SAMPLE_TITLE = 'Resonant-body pipe leak detector (fictional)';

export const SAMPLE_CLAIMS_TEXT = `1. An apparatus for detecting a leak in a fluid conduit, the apparatus comprising: a resonant body configured to vibrate at a natural frequency; and a sensor coupled to the resonant body, the sensor configured to output a signal indicative of the natural frequency.
2. The apparatus of claim 1, wherein the sensor comprises a piezoelectric element.
3. The apparatus of claim 1, wherein the processor is configured to compare the signal to a baseline value.
4. The apparatus of claim 2, wherein the piezoelectric element is coupled to the sensor in order to amplify the signal.
5. A method of detecting a leak, comprising: vibrating a resonant body at a natural frequency; and reading a signal from the sensor
6. The method of claim 5, wherein the signal is compared with the baseline value of claim 8.
7. The method of claim 5, further comprising storing a baseline value in a memory.
8. The method of claim 7, wherein the baseline value is updated when the natural frequency drifts.`;

export function sampleDocument(): ClaimDocument {
  return {
    title: SAMPLE_TITLE,
    claims: parseClaimBlock(SAMPLE_CLAIMS_TEXT).map((line) => createClaim(line.number, line.text)),
  };
}
