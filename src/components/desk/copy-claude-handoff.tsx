import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { buildClaudeHandoff } from "@/lib/trading/claude-handoff";
import { Button } from "@/components/ui/button";

export function CopyClaudeHandoff({ desk }: { desk: DeskPayload }) {
  const [ok, setOk] = useState(false);

  const copy = async () => {
    const text = buildClaudeHandoff(desk);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setOk(true);
    window.setTimeout(() => setOk(false), 2500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[10px]"
      onClick={() => void copy()}
      title="Copy full desk state for Claude / Cursor"
    >
      {ok ? (
        <>
          <Check className="mr-1 h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="mr-1 h-3 w-3" /> Copy for Claude
        </>
      )}
    </Button>
  );
}
