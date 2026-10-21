/** Bundled chat-trade journal + closed 1m bars (seed until chat_trades is migrated). Shadow only. */
import journal from "../../../data/chat-trades/chat-trades.json";
import qqq1021 from "../../../data/chat-trades/bars/QQQ-2026-10-21-1m.json";
import { chatSetupPriors, type Bar, type ChatTrade } from "./chat-trades";
export const CHAT_TRADES = journal as ChatTrade[];
export const CHAT_BARS: Record<string, Bar[]> = { "QQQ-2026-10-21": qqq1021 as Bar[] };
export const CHAT_PRIORS = chatSetupPriors(CHAT_TRADES);
