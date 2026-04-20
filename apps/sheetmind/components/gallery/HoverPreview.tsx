import React, { memo } from 'react';

export interface HoverPreviewProps {
    imageUrl: string | null;
    thumbnailRect: { left: number; right: number; top: number; bottom: number } | null;
}

export const HoverPreview = memo(function HoverPreview({
    imageUrl,
    thumbnailRect,
}: HoverPreviewProps) {
    if (!imageUrl || !thumbnailRect) return null;

    // Responsive preview size: adapt to window size
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Base size 480px (doubled from 240), max 50% of smaller screen dimension
    const maxDimension = Math.min(screenWidth, screenHeight) * 0.5;
    const basePreviewSize = Math.min(480, maxDimension);
    const previewWidth = basePreviewSize;
    const previewHeight = basePreviewSize;
    const padding = 15;

    // Try to position on the right of the thumbnail
    let left = thumbnailRect.right + padding;
    let top = thumbnailRect.top;

    // If no room on right, try left
    if (left + previewWidth > screenWidth) {
        left = thumbnailRect.left - previewWidth - padding;
    }

    // If still no room, position below
    if (left < 0) {
        left = Math.max(padding, thumbnailRect.left);
        top = thumbnailRect.bottom + padding;
    }

    // Ensure within viewport vertically
    if (top + previewHeight > screenHeight) {
        top = Math.max(padding, screenHeight - previewHeight - padding);
    }
    if (top < padding) top = padding;

    // Clamp left to ensure visibility
    if (left + previewWidth > screenWidth - padding) {
        left = screenWidth - previewWidth - padding;
    }
    if (left < padding) left = padding;

    return (
        <div
            className="fixed z-40 pointer-events-none"
            style={{ left, top }}
        >
            <div className="bg-white rounded-xl shadow-2xl p-3 border border-slate-200">
                <img
                    src={imageUrl}
                    alt=""
                    style={{
                        maxWidth: previewWidth - 24,
                        maxHeight: previewHeight - 24
                    }}
                    className="object-contain rounded-lg"
                />
            </div>
        </div>
    );
});
