/**
 * A row of chips: on touch screens it swipes sideways (scrollbar hidden); with a mouse or
 * trackpad, where a hidden sideways scroll can't be reached, it wraps onto more lines instead.
 */
export const CHIP_ROW_CLASS =
  "flex [scrollbar-width:none] gap-2 overflow-x-auto pt-1 pb-2 pointer-fine:flex-wrap pointer-fine:overflow-visible [&::-webkit-scrollbar]:hidden";
