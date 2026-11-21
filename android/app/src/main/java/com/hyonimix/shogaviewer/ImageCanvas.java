package com.hyonimix.shogaviewer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;

public final class ImageCanvas extends View {
    public interface SwipeListener {
        void onSwipe(int direction);
    }

    private final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final ScaleGestureDetector scaleDetector;
    private final GestureDetector gestureDetector;
    private Bitmap bitmap;
    private SwipeListener swipeListener;
    private float zoom = 1f;
    private float offsetX;
    private float offsetY;

    public ImageCanvas(Context context) {
        super(context);
        setContentDescription("Image viewer");
        scaleDetector = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScaleBegin(ScaleGestureDetector detector) {
                return bitmap != null;
            }

            @Override
            public boolean onScale(ScaleGestureDetector detector) {
                if (bitmap == null) {
                    return false;
                }
                float oldZoom = zoom;
                zoom = Math.max(1f, Math.min(5f, zoom * detector.getScaleFactor()));
                float factor = zoom / oldZoom;
                float focusX = detector.getFocusX() - getWidth() / 2f;
                float focusY = detector.getFocusY() - getHeight() / 2f;
                offsetX = focusX - (focusX - offsetX) * factor;
                offsetY = focusY - (focusY - offsetY) * factor;
                clampOffsets();
                invalidate();
                return true;
            }
        });
        gestureDetector = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent event) {
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent event) {
                zoom = 1f;
                offsetX = 0f;
                offsetY = 0f;
                invalidate();
                return true;
            }

            @Override
            public boolean onScroll(MotionEvent first, MotionEvent latest, float dx, float dy) {
                if (bitmap == null || zoom <= 1.01f || scaleDetector.isInProgress()) {
                    return false;
                }
                offsetX -= dx;
                offsetY -= dy;
                clampOffsets();
                invalidate();
                return true;
            }

            @Override
            public boolean onFling(MotionEvent first, MotionEvent last, float velocityX, float velocityY) {
                if (bitmap == null || swipeListener == null || first == null || last == null
                        || zoom > 1.01f) {
                    return false;
                }
                float moveX = last.getX() - first.getX();
                if (Math.abs(moveX) < dp(90) || Math.abs(velocityX) < dp(350)
                        || Math.abs(moveX) < Math.abs(last.getY() - first.getY())) {
                    return false;
                }
                swipeListener.onSwipe(moveX < 0 ? 1 : -1);
                return true;
            }
        });
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    public void setOnSwipeListener(SwipeListener listener) {
        swipeListener = listener;
    }

    public void setBitmap(Bitmap next) {
        bitmap = next;
        zoom = 1f;
        offsetX = 0f;
        offsetY = 0f;
        invalidate();
    }

    private float fittedScale() {
        if (bitmap == null || getWidth() == 0 || getHeight() == 0) {
            return 1f;
        }
        return Math.min(getWidth() / (float) bitmap.getWidth(),
                getHeight() / (float) bitmap.getHeight());
    }

    private void clampOffsets() {
        if (bitmap == null) {
            offsetX = 0f;
            offsetY = 0f;
            return;
        }
        float scale = fittedScale() * zoom;
        float extraX = (bitmap.getWidth() * scale - getWidth()) / 2f;
        float extraY = (bitmap.getHeight() * scale - getHeight()) / 2f;
        offsetX = extraX <= 0f ? 0f : Math.max(-extraX, Math.min(extraX, offsetX));
        offsetY = extraY <= 0f ? 0f : Math.max(-extraY, Math.min(extraY, offsetY));
    }

    @Override
    protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        clampOffsets();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (bitmap == null || bitmap.isRecycled()) {
            return;
        }
        float scale = fittedScale() * zoom;
        float width = bitmap.getWidth() * scale;
        float height = bitmap.getHeight() * scale;
        float x = (getWidth() - width) / 2f + offsetX;
        float y = (getHeight() - height) / 2f + offsetY;
        canvas.drawBitmap(bitmap, null, new RectF(x, y, x + width, y + height), bitmapPaint);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (bitmap == null) {
            return true;
        }
        scaleDetector.onTouchEvent(event);
        gestureDetector.onTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP) {
            performClick();
        }
        return true;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }
}
