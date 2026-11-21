package com.hyonimix.shogaviewer;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int REQUEST_IMAGES = 10;
    private static final String KEY_URIS = "selected_images";
    private static final String KEY_INDEX = "selected_index";

    private final ArrayList<Uri> images = new ArrayList<>();
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private ImageCanvas imageCanvas;
    private TextView status;
    private Button previous;
    private Button next;
    private Bitmap currentBitmap;
    private int currentIndex;
    private int loadGeneration;
    private boolean destroyed;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            ArrayList<String> saved = state.getStringArrayList(KEY_URIS);
            if (saved != null) {
                for (String value : saved) {
                    if (value != null && !value.isEmpty()) {
                        images.add(Uri.parse(value));
                    }
                }
            }
            currentIndex = Math.max(0, Math.min(state.getInt(KEY_INDEX, 0), images.size() - 1));
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF111820);
        root.setFitsSystemWindows(true);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(12), dp(10), dp(12), dp(10));
        TextView title = new TextView(this);
        title.setText("Shoga Viewer");
        title.setTextSize(20f);
        title.setTextColor(0xFFFFFFFF);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button select = new Button(this);
        select.setText("Open Images");
        select.setOnClickListener(view -> openImages());
        top.addView(select);
        root.addView(top);

        imageCanvas = new ImageCanvas(this);
        imageCanvas.setBackgroundColor(0xFF07090D);
        imageCanvas.setOnSwipeListener(direction -> move(direction));
        root.addView(imageCanvas, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(dp(8), dp(8), dp(8), dp(8));

        previous = new Button(this);
        previous.setText("Previous");
        previous.setOnClickListener(view -> move(-1));
        controls.addView(previous);

        status = new TextView(this);
        status.setTextColor(0xFFFFFFFF);
        status.setGravity(Gravity.CENTER);
        status.setTextSize(14f);
        controls.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        next = new Button(this);
        next.setText("Next");
        next.setOnClickListener(view -> move(1));
        controls.addView(next);

        root.addView(controls);
        setContentView(root);
        loadCurrent();
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void openImages() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(intent, REQUEST_IMAGES);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_IMAGES || resultCode != RESULT_OK || data == null) {
            return;
        }
        LinkedHashSet<Uri> selected = new LinkedHashSet<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) {
                    selected.add(uri);
                }
            }
        }
        if (data.getData() != null) {
            selected.add(data.getData());
        }
        if (!selected.isEmpty()) {
            images.clear();
            images.addAll(selected);
            currentIndex = 0;
            loadCurrent();
        }
    }

    private void move(int direction) {
        if (images.isEmpty()) {
            return;
        }
        int target = currentIndex + direction;
        if (target >= 0 && target < images.size()) {
            currentIndex = target;
            loadCurrent();
        }
    }

    private void loadCurrent() {
        final int generation = ++loadGeneration;
        boolean hasImages = !images.isEmpty();
        previous.setEnabled(hasImages && currentIndex > 0);
        next.setEnabled(hasImages && currentIndex < images.size() - 1);
        if (!hasImages) {
            imageCanvas.setBitmap(null);
            if (currentBitmap != null) {
                currentBitmap.recycle();
                currentBitmap = null;
            }
            status.setText("Open images to begin");
            return;
        }
        status.setText("Loading " + (currentIndex + 1) + "/" + images.size());
        Uri uri = images.get(currentIndex);
        decoder.execute(() -> {
            Bitmap decoded = null;
            String failure = null;
            try {
                decoded = decodeImage(uri);
                if (decoded == null) {
                    failure = "Image is unsupported";
                }
            } catch (IOException | SecurityException error) {
                failure = "Unable to open image";
            } catch (OutOfMemoryError error) {
                failure = "Image is too large";
            }
            Bitmap result = decoded;
            String message = failure;
            runOnUiThread(() -> {
                if (destroyed || generation != loadGeneration) {
                    if (result != null) {
                        result.recycle();
                    }
                    return;
                }
                Bitmap previousBitmap = currentBitmap;
                currentBitmap = result;
                imageCanvas.setBitmap(result);
                if (previousBitmap != null && previousBitmap != result) {
                    previousBitmap.recycle();
                }
                status.setText(message == null
                        ? (currentIndex + 1) + "/" + images.size()
                        : message);
            });
        });
    }

    private Bitmap decodeImage(Uri uri) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new IOException("Unable to read image");
            }
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }
        int sample = 1;
        while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 3072) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new IOException("Unable to read image");
            }
            return BitmapFactory.decodeStream(input, null, options);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        ArrayList<String> values = new ArrayList<>();
        for (Uri uri : images) {
            values.add(uri.toString());
        }
        out.putStringArrayList(KEY_URIS, values);
        out.putInt(KEY_INDEX, currentIndex);
        super.onSaveInstanceState(out);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        loadGeneration++;
        decoder.shutdownNow();
        if (currentBitmap != null) {
            currentBitmap.recycle();
            currentBitmap = null;
        }
        super.onDestroy();
    }
}
