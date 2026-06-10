// A thin draggable divider for resizing adjacent panels (NLE-style).
// Reports the live pointer X on drag start and each move; the parent turns those
// into a new panel width. Uses pointer capture so the drag keeps tracking even
// when the cursor moves fast over other elements. A wide invisible hit-area sits
// over a slim visible line that glows teal on hover/drag.
import { useRef, useState } from "react";
import { TEAL_GRADIENT } from "./theme";

export default function ResizeHandle({
  onStart, onMove, onEnd, ariaLabel = "Resize panel",
}: {
  onStart?: () => void;
  onMove: (clientX: number) => void;
  onEnd?: () => void;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    setActive(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    onStart?.();
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onMove(e.clientX);
  };
  const up = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onEnd?.();
  };

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="no-drag group relative z-20 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
    >
      {/* Visible slim line; brightens to teal on hover/active. */}
      <span
        className="my-1 w-[2px] rounded-full bg-line transition group-hover:bg-accent/60"
        style={active ? { background: TEAL_GRADIENT } : undefined}
      />
    </div>
  );
}
