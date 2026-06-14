"use client";

import { useEffect, useRef } from "react";

type Pixel = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
};

type Props = {
  text?: string;
  className?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  gap?: number;
  repelRadius?: number;
  align?: "left" | "center";
};

export default function PixelTextAnimation({
  text = "AI Data Layer for SWFL",
  className = "",
  color = "#0a8078",
  fontSize = 13,
  fontWeight = 600,
  gap = 2,
  repelRadius = 24,
  align = "left",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const pixelsRef = useRef<Pixel[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const font = `${fontWeight} ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;

    const getTextX = () => (align === "left" ? 0 : width / 2);

    const setup = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      width = parent.clientWidth;
      height = parent.clientHeight;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, width, height);
      ctx.font = font;
      ctx.textAlign = align === "left" ? "left" : "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(text, getTextX(), height / 2);

      const imageData = ctx.getImageData(0, 0, width, height).data;
      const pixels: Pixel[] = [];

      for (let y = 0; y < height; y += gap) {
        for (let x = 0; x < width; x += gap) {
          const a = imageData[(y * width + x) * 4 + 3];
          if (a > 120) {
            pixels.push({
              x: x + (Math.random() - 0.5) * 10,
              y: y + (Math.random() - 0.5) * 10,
              ox: x,
              oy: y,
              vx: (Math.random() - 0.5) * 0.35,
              vy: (Math.random() - 0.5) * 0.35,
              size: 1,
              alpha: Math.random() * 0.2 + 0.8,
            });
          }
        }
      }

      pixelsRef.current = pixels;
      ctx.clearRect(0, 0, width, height);
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.font = font;
      ctx.textAlign = align === "left" ? "left" : "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.95;
      ctx.fillText(text, getTextX(), height / 2);

      const mouse = mouseRef.current;
      for (const p of pixelsRef.current) {
        const dxHome = p.ox - p.x;
        const dyHome = p.oy - p.y;
        p.vx += dxHome * 0.05;
        p.vy += dyHome * 0.05;

        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (mouse.active && dist < repelRadius) {
          const force = (repelRadius - dist) / repelRadius;
          const angle = Math.atan2(dy, dx);
          p.vx += Math.cos(angle) * force * 0.8;
          p.vy += Math.sin(angle) * force * 0.8;
        }

        p.vx *= 0.9;
        p.vy *= 0.9;
        p.x += p.vx;
        p.y += p.vy;

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }

      ctx.globalAlpha = 1;
      frameRef.current = requestAnimationFrame(animate);
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      mouseRef.current.active = true;
    };

    const onLeave = () => {
      mouseRef.current.active = false;
      mouseRef.current.x = -9999;
      mouseRef.current.y = -9999;
    };

    setup();
    animate();

    window.addEventListener("resize", setup);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", setup);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [text, color, fontSize, fontWeight, gap, repelRadius, align]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
