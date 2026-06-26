import Image from "next/image";
import { cn } from "@/lib/utils";

// AgentBox brand mark. `size` is the rendered height in px (square source).
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/agentbox.png"
      alt="AgentBox"
      width={size}
      height={size}
      priority
      unoptimized
      className={cn("object-contain", className)}
    />
  );
}
