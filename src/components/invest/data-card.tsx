/**
 * WHERE THE RECORD LIVES — sync status, and the manual backup.
 *
 * The ledger is written in this browser first (it must work offline and
 * signed out) and mirrored to the server's invest_ledger table. This card
 * says which of those is true right now, and offers the export/import that
 * works even when the server does not.
 */

import { useRef, useState } from "react";
import { exportLedger, importLedger } from "@/lib/invest/store";
import type { SyncState } from "@/lib/invest/sync";
import { BUTTON } from "./format";
import { Card, Note } from "./ui";

export function DataCard({
  sync,
  syncing,
  onSync,
  entries,
  onWrite,
}: {
  sync: SyncState | null;
  syncing: boolean;
  onSync: () => void;
  entries: number;
  onWrite: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const download = () => {
    const text = exportLedger();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invest-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMsg(`Exported ${entries} entr${entries === 1 ? "y" : "ies"}.`);
  };

  return (
    <Card
      title="Where the record lives"
      right={
        <span className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={onSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" className={BUTTON} onClick={download}>
            Export
          </button>
          <button type="button" className={BUTTON} onClick={() => file.current?.click()}>
            Import
          </button>
        </span>
      }
    >
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 5_000_000) return setMsg("That file is larger than any ledger export — refused.");
          const res = importLedger(await f.text());
          setMsg(`${res.why}${res.skipped ? ` ${res.skipped} already here.` : ""}${res.refused ? ` ${res.refused} malformed row(s) refused.` : ""}`);
          if (res.added) onWrite();
        }}
      />
      <Note tone={sync?.status === "local" ? "warn" : undefined}>
        {sync
          ? `${sync.why} (${new Date(sync.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET)`
          : "Checking the server ledger…"}
      </Note>
      {sync?.conflicts.map((c) => (
        <Note key={c} tone="warn">
          {c}
        </Note>
      ))}
      <Note>
        {entries} entr{entries === 1 ? "y" : "ies"} in this browser. Every entry is also written to the server (append-only,
        insert-or-ignore), so a cleared cache or a second device does not lose the habit record. Import merges by id — it never
        overwrites anything already here.
      </Note>
      {msg && <Note>{msg}</Note>}
    </Card>
  );
}
