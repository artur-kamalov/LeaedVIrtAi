import React from "react";
import { ImageWithFallback } from "../figma/ImageWithFallback";

export const GlowBg = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-zinc-950">
      {/* Abstract Texture */}
      <div className="absolute top-0 left-0 right-0 h-[1200px] opacity-20 mix-blend-screen mask-image-b">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950 z-10" />
        <ImageWithFallback 
          src="https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbW9kZXJuJTIwYWJzdHJhY3QlMjBiYWNrZ3JvdW5kfGVufDF8fHx8MTc4MTczOTMxOHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Abstract dark modern background"
          className="w-full h-full object-cover grayscale opacity-30"
        />
      </div>

      <div className="absolute top-[-100px] -left-[10%] w-[50vw] h-[800px] rounded-full bg-indigo-600/30 blur-[120px] mix-blend-screen" />
      <div className="absolute top-[100px] -right-[10%] w-[40vw] h-[900px] rounded-full bg-emerald-600/20 blur-[120px] mix-blend-screen" />
      <div className="absolute top-[600px] left-[20%] w-[60vw] h-[700px] rounded-full bg-fuchsia-600/20 blur-[150px] mix-blend-screen" />
      
      {/* Grid overlay for hero */}
      <div className="absolute top-0 left-0 right-0 h-[1000px] bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
    </div>
  );
};
