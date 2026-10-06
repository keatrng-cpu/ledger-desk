/**
 * PM signal API barrel — what Prototype Lab / Mead Hall import.
 *
 *   Server fn (POST, public, read-only):
 *     getPredictionSignals({ series?, limitPerSeries?, candles?, models? }) → SignalBoard
 *       from "@/lib/predict/predict-server"
 *   Pure (client-safe):
 *     buildSignalBoard / computeSignal / hallLayout / rankSignals   (signal-engine)
 *     scorePaper / walkForward / paperTicketFromSignal              (paper-scorer)
 *
 * No order path anywhere in this API. Paper tickets are plain objects.
 */
export * from "./signal-engine";
export * from "./paper-scorer";
export * from "./signal-evidence";
