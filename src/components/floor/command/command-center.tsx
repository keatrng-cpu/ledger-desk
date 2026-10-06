/**
 * Floor command center — decision strip + command cards + drawer.
 * 2D panel layer only; does not touch the 3D scene files.
 */
import { useCallback, useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { ManagerRoomState } from "@/lib/room/manager-feed";
import type { useEntryState } from "@/components/desk/use-entry-state";
import { FloorDecisionStrip } from "./decision-strip";
import { CommandGrid } from "./command-grid";
import { CommandDrawer } from "./command-drawer";
import { useCommandReads } from "./use-command-reads";
import type { CommandTabId } from "./types";

export function FloorCommandCenter({
  desk,
  entry,
  managerState,
  onManager,
}: {
  desk: DeskPayload | null;
  entry: ReturnType<typeof useEntryState>["read"];
  managerState: ManagerRoomState | null;
  onManager: () => void;
}) {
  const reads = useCommandReads(desk);
  const [openId, setOpenId] = useState<CommandTabId | null>(null);
  const onClose = useCallback(() => setOpenId(null), []);

  return (
    <div className="space-y-3">
      <FloorDecisionStrip
        desk={desk}
        entry={entry}
        managerState={managerState}
        onManager={onManager}
      />
      <CommandGrid reads={reads} active={openId} onOpen={setOpenId} />
      <CommandDrawer openId={openId} desk={desk} onClose={onClose} />
    </div>
  );
}
