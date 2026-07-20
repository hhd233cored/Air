"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

const CROP_WIDTH = 900;
const CROP_HEIGHT = 300;

type Point = { x: number; y: number };

type CoverCropperProps = {
  file: File;
  onApply: (file: File) => void;
  onCancel: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function safeBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "cover";
}

export function CoverCropper({ file, onApply, onCancel }: CoverCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointer: Point; offset: Point } | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [cropError, setCropError] = useState("");

  useEffect(() => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageReady(true);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.onerror = () => setCropError("这张图片无法读取，请换一张图片。");
    image.src = sourceUrl;
    return () => {
      imageRef.current = null;
      URL.revokeObjectURL(sourceUrl);
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !imageReady || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const scale = Math.max(CROP_WIDTH / image.naturalWidth, CROP_HEIGHT / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const maxX = Math.max(0, (width - CROP_WIDTH) / 2);
    const maxY = Math.max(0, (height - CROP_HEIGHT) / 2);
    const xOffset = clamp(offset.x, -maxX, maxX);
    const yOffset = clamp(offset.y, -maxY, maxY);

    context.clearRect(0, 0, CROP_WIDTH, CROP_HEIGHT);
    context.fillStyle = "#f6f1f8";
    context.fillRect(0, 0, CROP_WIDTH, CROP_HEIGHT);
    context.drawImage(image, (CROP_WIDTH - width) / 2 + xOffset, (CROP_HEIGHT - height) / 2 + yOffset, width, height);
  }, [imageReady, offset, zoom]);

  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (CROP_WIDTH / bounds.width),
      y: (event.clientY - bounds.top) * (CROP_HEIGHT / bounds.height),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!imageReady) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointer: pointerPosition(event), offset };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = pointerPosition(event);
    setOffset({ x: drag.offset.x + pointer.x - drag.pointer.x, y: drag.offset.y + pointer.y - drag.pointer.y });
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const apply = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imageReady) return;
    setCropError("");
    canvas.toBlob((blob) => {
      if (!blob) {
        setCropError("裁剪失败，请重新选择图片。");
        return;
      }
      onApply(new File([blob], `${safeBaseName(file.name)}-cover.webp`, { type: "image/webp", lastModified: Date.now() }));
    }, "image/webp", 0.92);
  };

  return (
    <div className="editor-cover-cropper">
      <div className="editor-cover-cropper__header">
        <strong>裁剪封面图</strong>
        <span>拖动图片调整位置，输出为 3:1 横向封面</span>
      </div>
      <canvas
        ref={canvasRef}
        className="editor-cover-cropper__canvas"
        width={CROP_WIDTH}
        height={CROP_HEIGHT}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="封面图裁剪区域"
      />
      <label className="editor-cover-cropper__zoom">
        缩放
        <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={!imageReady} />
        <span>{zoom.toFixed(2)}×</span>
      </label>
      {cropError ? <p className="editor-message editor-message--error">{cropError}</p> : null}
      <div className="editor-cover-cropper__actions">
        <button className="editor-button editor-button--secondary" type="button" onClick={onCancel}>取消裁剪</button>
        <button className="editor-button" type="button" onClick={apply} disabled={!imageReady}>使用此裁剪</button>
      </div>
    </div>
  );
}
