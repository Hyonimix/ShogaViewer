# Shoga Viewer
Shoga Viewer is an image and manga viewer optimized for ChromeOS devices. It utilizes modern web APIs to provide local-first directory access and hardware-accelerated rendering. Please note that this application is not designed for environments other than ChromeOS, and its normal operation in such environments is not guaranteed.

## Key Attributes
* **Manga Viewing Modes**: Supports Single and Spread (dual-page) layouts. Includes native Right-to-Left (RTL) reading direction and various viewport fit options (Contain, Auto, Width, Height, Original).
* **Real-Time Upscaling**: Provides WebGL-accelerated image scaling algorithms.
    1. **Bilinear**: Standard hardware-accelerated smoothing.
    2. **Adaptive Shoga+**: Shoga Viewer's proprietary lightweight algorithm, suitable for all types of images and optimized for low-end ChromeOS devices.
    3. **Anime4K**: Optimized for illustrations and animation.
    4. **xBRZ**: Specialized for retro games and edge preservation.
    5. **FSR Shoga+ (AMD FidelityFX Super Resolution with Anti-Jaggies)**: High-fidelity scaling with integrated anti-aliasing.
    * Note: Dynamic scaling (up to x4) is applied based on device memory (16GB+ RAM). Background preloading is supported via a queue system.
* **FileSystem Integration**: Accesses local directories directly through the FileSystem Access API. Supports nested subfolder navigation, directory-level sorting (Name Asc/Desc), and folder name filtering.
* **Hardware Acceleration**: Implements asynchronous image decoding and high-performance thumbnail generation using ImageBitmap.
* **Interaction Model**: Optimized for touch and mouse input. Supports pinch-to-zoom, panning, double-tap reset, and edge-swipe gestures for navigation and UI toggling.
* **Session Management**: Tracks recent sessions and reading progress using IndexedDB. Includes a searchable bookmark system that restores directory stacks, file indices, and layout configurations.

## Usage Guide
1. **Data Input**: Use "SELECT DIRECTORY" to grant folder access. The application indexes images within the selected path, including subfolders.
2. **Navigation**: Use the grid view for overview or the viewer for reading. Supports horizontal swipes, arrow keys, and screen-edge taps for paging.
3. **Display Control**: Zoom via mouse wheel or pinch gesture. Adjust layout, reading direction, and upscaling algorithms through the settings panel.
4. **Bookmarks**: Save the current state using the "+ ADD" button. Access and filter saved bookmarks via the searchable bookmarks panel.

## System Requirements
| Feature | Minimum | Recommended | Optional (for x4 mode) |
|:---|:---|:---|:---|
| **Processor** | Snapdragon 7c / Celeron N4020 | Snapdragon 7c Gen 2 / Core i3 | Intel Core i5 / Equivalent |
| **Memory** | 4GB RAM | 8GB+ RAM | 16GB+ RAM |
| **Display** | 1280 x 720 | 1920 x 1080 | 2560 x 1440+ |

## License
Copyright (c) 2026 D5 Kan. Distributed under the MIT License.
