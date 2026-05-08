# Shoga Viewer
Shoga Viewer is a high-performance media and manga viewer optimized for ChromeOS devices. It utilizes modern web APIs to provide local-first directory access, personal media server streaming, and hardware-accelerated rendering. Please note that this application is not designed for environments other than ChromeOS, and its normal operation in such environments is not guaranteed.

## Key Attributes
* **Media Access & Integration**: Access local directories directly through the FileSystem Access API with nested subfolder navigation and filtering, or connect to a personal Jellyfin server for remote media streaming.
* **Video Playback & Transcoding**: Smooth playback for various video formats (MP4, WebM, MKV, AVI, etc.) with a built-in, on-device FFmpeg.wasm transcoder to automatically convert unsupported codecs.
* **Manga Viewing Modes**: Supports Single and Spread (dual-page) layouts. Includes native Right-to-Left (RTL) reading direction and various viewport fit options (Contain, Auto, Width, Height, Original).
* **Real-Time Upscaling**: Provides WebGL-accelerated image scaling algorithms.
    1. **Bilinear**: Standard hardware-accelerated smoothing.
    2. **Adaptive Shoga+**: Shoga Viewer's proprietary lightweight algorithm, suitable for all types of images and optimized for low-end ChromeOS devices.
    3. **Anime4K**: Optimized for illustrations and animation.
    4. **xBRZ**: Specialized for retro games and edge preservation.
    5. **FSR Shoga+ (AMD FidelityFX Super Resolution with Anti-Jaggies)**: High-fidelity scaling with integrated anti-aliasing.
    * Note: Dynamic scaling (up to x4) is applied based on device memory (16GB+ RAM). Background preloading is supported via a queue system.
* **Hardware Acceleration**: Implements asynchronous image decoding and high-performance thumbnail generation using ImageBitmap.
* **Interaction Model**: Optimized for touch and mouse input. Supports pinch-to-zoom, panning, double-tap reset, and edge-swipe gestures for navigation and UI toggling.
* **Session Management**: Tracks recent sessions and reading progress using IndexedDB. Includes a searchable bookmark system that restores directory stacks, file indices, and layout configurations.

## Usage Guide
1. **Data Input**: Use "SELECT FILE(S)" or "SELECT DIRECTORY" to grant local access, or use "CONNECT TO JELLYFIN" to access your server. The application indexes media within the selected path.
2. **Navigation**: Use the grid view for overview or the viewer for reading/watching. Supports horizontal swipes, arrow keys, and screen-edge taps for paging.
3. **Display Control**: Zoom via mouse wheel or pinch gesture. Adjust layout, reading direction, and upscaling algorithms through the settings panel.
4. **Bookmarks**: Save the current state using the "+ ADD" button. Access and filter saved bookmarks via the searchable bookmarks panel.

## System Requirements
| Feature | Minimum | Recommended | Optional (for x4 mode) |
|:---|:---|:---|:---|
| **Processor** | Snapdragon 7c / Celeron N4020 | Snapdragon 7c Gen 2 / Core i3 | Intel Core i5 / Equivalent |
| **Memory** | 4GB RAM | 8GB+ RAM | 16GB+ RAM |
| **Display** | 1280 x 720 | 1920 x 1080 | 2560 x 1440+ |

## License
This project is licensed under the **GNU General Public License v3.0 (GPLv3)** - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses
Shoga Viewer incorporates or is derived from the following open-source components:
* **xBRZ**: Licensed under the GNU General Public License.
* **FFmpeg & libx264**: Licensed under the GNU General Public License.
* **FXAA (Fast Approximate Anti-Aliasing)**: Copyright (c) NVIDIA Corporation. Licensed under the BSD License.
* **AMD FidelityFX Super Resolution (FSR)**: Copyright (c) Advanced Micro Devices, Inc. Licensed under the MIT License.
* **Anime4K**: Copyright (c) bloc97. Licensed under the MIT License.
* **Feather Icons**: Copyright (c) Cole Bemis. Licensed under the MIT License.
* **hls.js**: Licensed under the Apache License 2.0.
* **FFmpeg.wasm**: Licensed under the MIT License.

Copyright (c) 2026 D5 Kan.
