"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Roving tabindex for one listbox or grid.
 * Arrow keys are handled on the focused row, not on the document.
 */
export function useRovingRows(count: number) {
  const [selected, setSelected] = useState<number | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (selected != null && selected >= count) setSelected(count > 0 ? count - 1 : null);
  }, [count, selected]);

  useEffect(() => {
    if (selected == null) return;
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function tabIndex(index: number): number {
    if (count === 0) return -1;
    if (selected == null) return index === 0 ? 0 : -1;
    return index === selected ? 0 : -1;
  }

  function select(index: number) {
    setSelected(index);
    itemRefs.current[index]?.focus();
  }

  function move(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown" ? Math.min(count - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : Math.max(0, count - 1);
    setSelected(next);
    itemRefs.current[next]?.focus();
  }

  return { selected, select, move, tabIndex, itemRefs };
}
